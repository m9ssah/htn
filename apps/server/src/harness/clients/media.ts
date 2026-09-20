import type { ResearchClient } from '../types.js';

/**
 * Finds a picture or a clip of what the user is asking about.
 *
 * Wikimedia Commons, because it needs no key and its URLs are stable and
 * hot-linkable — a demo that depends on a key nobody has at 3am is a demo
 * that does not run. It goes through the same SSRF-guarded fetch client as
 * `research`, so a model-suggested subject cannot become a request to
 * somewhere private.
 *
 * **Commons has far more stills than clips for cooking.** A video is
 * preferred when one exists and an image is used when it does not; which one
 * came back is reported rather than smoothed over, because "show me how" is
 * a different promise from "here is a photo".
 */

export type MediaHit = {
  url: string;
  kind: 'video' | 'image';
  title: string;
};

export type MediaFinder = {
  find(subject: string, signal: AbortSignal): Promise<MediaHit | null>;
};

const ENDPOINT = 'https://commons.wikimedia.org/w/api.php';

const query = (search: string, namespaceSearch: string): string =>
  `${ENDPOINT}?action=query&generator=search&gsrsearch=${encodeURIComponent(search)}`
  + `${namespaceSearch}&gsrlimit=6&prop=imageinfo&iiprop=url%7Cmime&format=json&origin=*`;

type CommonsResponse = {
  query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ url?: string; mime?: string }> }> };
};

function pick(body: string): MediaHit[] {
  let parsed: CommonsResponse;
  try {
    parsed = JSON.parse(body) as CommonsResponse;
  } catch {
    return [];
  }
  const pages = Object.values(parsed.query?.pages ?? {});
  return pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    const url = info?.url;
    const mime = info?.mime ?? '';
    if (!url) return [];
    if (!mime.startsWith('video/') && !mime.startsWith('image/')) return [];
    // `.svg` renders as a diagram rather than a photo, and an `.ogv` will not
    // play in Chromium — neither is what "show me" means here.
    if (/\.(svg|ogv|tif|tiff)(\?|$)/i.test(url)) return [];
    return [{ url, kind: mime.startsWith('video/') ? ('video' as const) : ('image' as const), title: page.title ?? '' }];
  });
}

export function createMediaFinder(fetcher: ResearchClient): MediaFinder {
  return {
    async find(subject, signal): Promise<MediaHit | null> {
      // Video first — if a clip of this exists it is the better answer — then
      // fall back to a still rather than returning nothing.
      const attempts = [
        query(`filetype:video ${subject}`, ''),
        query(subject, '&gsrnamespace=6'),
      ];

      for (const url of attempts) {
        const outcome = await fetcher.get(url, signal);
        // `ok` means the exchange completed, not that it succeeded — a 403
        // body parses to zero results and looks exactly like "nothing found".
        if (!outcome.ok || outcome.status !== 200) continue;
        const hits = pick(outcome.body);
        const video = hits.find((h) => h.kind === 'video');
        if (video) return video;
        const image = hits[0];
        if (image) return image;
      }
      return null;
    },
  };
}

/** Deterministic, no network. What tests and offline dev run against. */
export const stubMediaFinder: MediaFinder = {
  async find(subject): Promise<MediaHit | null> {
    return { url: `https://example.test/${encodeURIComponent(subject)}.jpg`, kind: 'image', title: subject };
  },
};
