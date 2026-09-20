import json
import os
from pathlib import Path

import torch
from datasets import Dataset
from huggingface_hub import login, whoami
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer

MODEL_ID = os.environ.get("MODEL_ID", "Qwen/Qwen2.5-14B-Instruct")

hf_token = os.environ.get("HF_TOKEN")
if hf_token:
    login(token=hf_token)
    who = whoami(token=hf_token)
    print(f"Authenticated to Hugging Face as: {who.get('name')}")
else:
    print("No HF_TOKEN set — proceeding unauthenticated (model is ungated).")

SYSTEM_PROMPT = (
    "You fill named text fields on UI targets from a jit.content.request.v1 "
    "payload. Return only a jit.content.result.v1 JSON object mapping "
    "elementId to its field values. Never include a field marked as a "
    "business fact, never invent an elementId not in targets, and omit any "
    "optional field you have nothing for."
)


def load_examples() -> Dataset:
    rows = []
    with open(DATASET_PATH) as f:
        for line in f:
            record = json.loads(line)
            if record.get("expectRejection"):
                continue
            rows.append(
                {
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps(record["request"])},
                        {"role": "assistant", "content": json.dumps(record["result"])},
                    ]
                }
            )
    return Dataset.from_list(rows)


dataset = load_examples().train_test_split(test_size=0.1, seed=0)

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    use_cache=False,
)

peft_config = LoraConfig(   # parameter efficient fine-tuning config
    r=8,
    lora_alpha=16,
    target_modules="all-linear",
    lora_dropout=0.05,
    task_type="CAUSAL_LM",
)

training_args = SFTConfig(
    learning_rate=2e-4,
    num_train_epochs=3,
    logging_steps=5,
    per_device_train_batch_size=int(os.environ.get("TRAIN_BATCH_SIZE", "2")),
    gradient_accumulation_steps=int(os.environ.get("GRAD_ACCUM_STEPS", "8")),
    gradient_checkpointing=True,
    max_length=1024,
    warmup_steps=5,
    lr_scheduler_type="cosine",
    eval_strategy="steps",
    eval_steps=25,
    save_steps=25,
    bf16=True,
    output_dir=os.getenv("BT_CHECKPOINT_DIR", "./checkpoints"),
)

trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset["train"],
    eval_dataset=dataset["test"],
    processing_class=tokenizer,
    peft_config=peft_config,
)
trainer.train()

trainer.save_model(training_args.output_dir)
print(f"Training complete. Model saved to {training_args.output_dir}")
