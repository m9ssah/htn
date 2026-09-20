"""Minimal stdlib-only client for TypeSafe's System One API (model: Jev).

Jev is a judgment model, not a generative one: you send `state` plus typed
questions and get back probabilities. Three question types exist --
choice / score / noul -- and nothing else. There is no free-text output.

Docs: https://docs.typesafe.ai  |  Endpoint: POST https://api.typesafe.ai/v1/systemone
"""

from __future__ import annotations

import http.client
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

HOST = "api.typesafe.ai"
PATH = "/v1/systemone"
ENDPOINT = f"https://{HOST}{PATH}"
KEY_FILE = Path.home() / ".config" / "typesafe" / "env"

# TypeSafe bills input tokens only; output is free. Rate as documented Sept 2026.
USD_PER_INPUT_TOKEN = 42.0 / 1e9


def load_key() -> str:
    key = os.environ.get("TYPESAFE_API_KEY")
    if key:
        return key
    if KEY_FILE.exists():
        m = re.search(r"TYPESAFE_API_KEY=(\S+)", KEY_FILE.read_text())
        if m:
            return m.group(1)
    raise RuntimeError(f"No TYPESAFE_API_KEY in env or {KEY_FILE}")


@dataclass
class Answer:
    """One question's result, normalised across the three primitives."""

    qid: str
    type: str
    raw: dict

    @property
    def value(self):
        return self.raw.get(self.type)

    @property
    def confidence(self) -> float | None:
        # Noul returns a bare probability and no confidence field.
        if self.type == "noul":
            p = self.raw.get("noul")
            return None if p is None else abs(p - 0.5) * 2
        return self.raw.get("confidence")

    @property
    def probabilities(self) -> dict | None:
        return self.raw.get("probabilities")


@dataclass
class Result:
    ok: bool
    latency_s: float
    answers: dict[str, Answer] = field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""
    error: str | None = None
    status: int | None = None

    @property
    def usd(self) -> float:
        return self.input_tokens * USD_PER_INPUT_TOKEN


class Budget(Exception):
    pass


class Jev:
    """Thin client with latency timing and a hard spend/request ceiling."""

    def __init__(self, *, max_requests: int = 2000, max_usd: float = 2.00,
                 timeout_s: float = 20.0, model: str = "jev-latest",
                 keep_alive: bool = True):
        self._key = load_key()
        # A fresh TLS handshake per call costs ~260ms -- 63% of the observed
        # latency. Reusing one connection is the difference between a 412ms and
        # a 152ms p50, so it is on by default.
        self.keep_alive = keep_alive
        self._conn: http.client.HTTPSConnection | None = None
        self.model = model
        self.timeout_s = timeout_s
        self.max_requests = max_requests
        self.max_usd = max_usd
        self.requests = 0
        self.input_tokens = 0
        self.output_tokens = 0

    @property
    def usd(self) -> float:
        return self.input_tokens * USD_PER_INPUT_TOKEN

    def evaluate(self, state, questions: dict) -> Result:
        if self.requests >= self.max_requests:
            raise Budget(f"request cap reached ({self.max_requests})")
        if self.usd >= self.max_usd:
            raise Budget(f"spend cap reached (${self.usd:.4f})")

        body = json.dumps(
            {"state": state, "model": self.model, "questions": questions}
        ).encode()
        req = urllib.request.Request(
            ENDPOINT, data=body, method="POST",
            headers={"Authorization": f"Bearer {self._key}",
                     "Content-Type": "application/json"},
        )
        headers = {"Authorization": f"Bearer {self._key}",
                   "Content-Type": "application/json", "Connection": "keep-alive"}
        t0 = time.perf_counter()
        try:
            if self.keep_alive:
                payload, status = self._send_keepalive(body, headers)
            else:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    payload, status = json.loads(resp.read()), resp.status
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:500]
            return Result(ok=False, latency_s=time.perf_counter() - t0,
                          error=detail, status=e.code)
        except Exception as e:  # timeout, DNS, TLS
            self._conn = None
            return Result(ok=False, latency_s=time.perf_counter() - t0,
                          error=f"{type(e).__name__}: {e}")
        dt = time.perf_counter() - t0

        usage = payload.get("usage", {})
        self.requests += 1
        self.input_tokens += usage.get("input_tokens", 0)
        self.output_tokens += usage.get("output_tokens", 0)
        return Result(
            ok=True, latency_s=dt, status=status,
            model=payload.get("model", ""),
            answers={k: Answer(k, v.get("type", "noul"), v)
                     for k, v in payload.get("answers", {}).items()},
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
        )


    def _send_keepalive(self, body: bytes, headers: dict):
        for attempt in (1, 2):  # one retry, in case the pooled socket went stale
            try:
                if self._conn is None:
                    self._conn = http.client.HTTPSConnection(
                        HOST, timeout=self.timeout_s, context=ssl.create_default_context())
                self._conn.request("POST", PATH, body=body, headers=headers)
                resp = self._conn.getresponse()
                raw, status = resp.read(), resp.status
                if status >= 400:
                    raise urllib.error.HTTPError(ENDPOINT, status, raw.decode()[:500], None, None)
                return json.loads(raw), status
            except (http.client.HTTPException, ConnectionError, OSError):
                try:
                    self._conn.close()
                except Exception:
                    pass
                self._conn = None
                if attempt == 2:
                    raise

    def close(self):
        if self._conn is not None:
            self._conn.close(); self._conn = None


# --- question constructors -------------------------------------------------

def choice(instructions: str, criteria: dict[str, str]) -> dict:
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def score(instructions: str, levels: list[str]) -> dict:
    return {"type": "score", "instructions": instructions, "criteria": levels}


def noul(instructions: str, *, true: str | None = None,
         false: str | None = None) -> dict:
    """A yes/no judgment.

    `criteria` is documented but optional. Supplying it is what stops an
    under-specified question from drifting -- omitting it was the cause of the
    conservative bias first attributed to the model.
    """
    q = {"type": "noul", "instructions": instructions}
    if true is not None or false is not None:
        q["criteria"] = {"true": true or "", "false": false or ""}
    return q
