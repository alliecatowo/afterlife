/**
 * Shareable world links. A world (or a selection of it) plus its rule is
 * encoded into the URL hash as `#w=<rule>;<x>;<y>;<rle body>` (URL-escaped), so
 * a copied link reopens the same pattern under the same rule on any machine.
 * Pure string work: no DOM, no storage. Size-capped so links stay pasteable.
 */
import { fromRLE, toRLE } from './rle';
import type { ParsedPattern } from './rle';

/** Longest hash (characters, including `#w=`) a share link may carry. */
export const MAX_SHARE_HASH = 6000;

export class ShareTooLargeError extends Error {
  constructor(public readonly length: number) {
    super(`This pattern is too large for a link (${length} characters, limit ${MAX_SHARE_HASH}). Export an RLE or JSON file instead.`);
    this.name = 'ShareTooLargeError';
  }
}

/** Encode `cells` (row-major over `rect`, 1 = alive) and `rule` as a location hash. Throws if there are no live cells or the hash is too long. */
export function encodeShareHash(cells: Uint8Array, rect: { w: number; h: number }, rule: string): string {
  const rle = toRLE(cells, rect, undefined, { rule });
  const lines = rle.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const header = lines.find((l) => /^x\s*=/.test(l));
  if (!header) throw new Error('share: nothing to share');
  const dims = /x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/.exec(header);
  const ruleM = /rule\s*=\s*([^\s,]+)/i.exec(header);
  const body = lines.filter((l) => l !== header).join('');
  if (!dims || !body || body === '!') throw new Error('share: nothing to share — the world is empty');
  const payload = [ruleM?.[1] ?? rule, dims[1], dims[2], body].join(';');
  const hash = `#w=${encodeURIComponent(payload)}`;
  if (hash.length > MAX_SHARE_HASH) throw new ShareTooLargeError(hash.length);
  return hash;
}

/** Parse a location hash made by `encodeShareHash`. Returns null when it is not a share hash or is malformed/unsupported (never throws). */
export function parseShareHash(hash: string): ParsedPattern | null {
  try {
    if (!hash.startsWith('#w=') || hash.length > MAX_SHARE_HASH) return null;
    const payload = decodeURIComponent(hash.slice(3));
    const parts = payload.split(';');
    if (parts.length !== 4) return null;
    const [rule, x, y, body] = parts as [string, string, string, string];
    if (!/^\d+$/.test(x) || !/^\d+$/.test(y) || !/^[0-9bo$!\s]+$/i.test(body)) return null;
    return fromRLE(`x = ${x}, y = ${y}, rule = ${rule}\n${body}`);
  } catch {
    return null;
  }
}
