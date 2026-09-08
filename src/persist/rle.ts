/**
 * Life 1.06/1.05-compatible RLE codec ("Life RLE", the format used by Golly,
 * LifeWiki, etc). Owned by `persist` (rule-generalisation pass: `core`).
 *
 * Grammar (informal):
 *   file    := header* dims body
 *   header  := "#" tag SP? rest NEWLINE          -- N (name), C/c (comment),
 *                                                     O (author), P/R (offset)
 *   dims    := "x" "=" INT "," "y" "=" INT ("," "rule" "=" RULE)? NEWLINE
 *   body    := (run? tag)* "!"?                  -- tag one of b|o|$
 *   run     := INT                                -- defaults to 1 when absent
 *
 * We tolerate real-world mess: CRLF line endings, a missing trailing "!",
 * whitespace/newlines inside the run data (lines wrapped at ~70 cols), and an
 * omitted "rule=" clause (assumed B3/S23, the LifeWiki convention).
 *
 * Rule honesty: now that `@/core/engine` can actually SIMULATE any Life-like
 * B/S rule (see `@/core/rule.ts`), import accepts one and reports it on
 * `ParsedPattern.rule` (canonical form) rather than rejecting anything but
 * Conway. We still refuse to load a genuinely unsupported family — Generations
 * (3+ states), Hensel/non-totalistic notation, or a non-Moore/Larger-than-Life
 * neighbourhood — via `UnsupportedRuleError`, whose message names exactly what
 * was found (delegated to `@/core/rule.ts`'s `parseRule`/`RuleParseError`).
 */
import type { Rect, StampPattern } from '@/core/types';
import { CONWAY_RULE_STRING, RuleParseError, parseRule } from '@/core/rule';

/** A parsed RLE pattern, widened with the header metadata worth preserving. */
export interface ParsedPattern extends StampPattern {
  /** `#C`/`#c` lines, in file order. */
  comments: string[];
  /** `#O` line, if present. */
  author?: string;
  /** `#P`/`#R` offset, if present. */
  offsetX?: number;
  offsetY?: number;
  /** Canonical B/S rulestring this pattern was authored for (default `"B3/S23"` when the file omits `rule=`). */
  rule: string;
}

/** Thrown when an RLE file names a rule this engine cannot simulate at all. */
export class UnsupportedRuleError extends Error {
  constructor(
    public readonly rawRule: string,
    public readonly reason: string = 'not a supported Life-like rule',
  ) {
    super(
      `Unsupported rule "${rawRule}": ${reason} — AFTERLIFE simulates any 2-state, ` +
        `outer-totalistic B/S rule on the 8-cell Moore neighbourhood, but not this.`,
    );
    this.name = 'UnsupportedRuleError';
  }
}

/**
 * Validate (and normalise) a `rule=` clause. Accepts any Life-like B/S
 * rulestring `@/core/rule.ts`'s engine can actually simulate — Conway,
 * HighLife, Seeds, Day & Night, etc — in any of the tolerated spellings
 * (`B3/S23`, `b3/s23`, `S23/B3`, historic `23/3`). Throws
 * `UnsupportedRuleError` (naming what was found) for a genuinely unsupported
 * family: Generations, Hensel/non-totalistic notation, or a non-Moore/
 * Larger-than-Life neighbourhood. Returns the canonical rulestring.
 */
export function checkRule(raw: string): string {
  try {
    return parseRule(raw).rule;
  } catch (err) {
    if (err instanceof RuleParseError) throw new UnsupportedRuleError(raw, err.reason);
    throw err;
  }
}

/** Parse the already-dewhitespaced body into a row-major `Uint8Array`. */
function parseBody(body: string, width: number, height: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, width * height));
  let x = 0;
  let y = 0;
  const re = /(\d*)([bo$])/g;
  let match: RegExpExecArray | null;
  while (y < height && (match = re.exec(body))) {
    const count = match[1] ? parseInt(match[1], 10) : 1;
    const tag = match[2];
    if (tag === 'b') {
      x += count;
    } else if (tag === 'o') {
      for (let i = 0; i < count; i++) {
        if (x >= 0 && x < width && y >= 0 && y < height) out[y * width + x] = 1;
        x++;
      }
    } else {
      y += count;
      x = 0;
    }
  }
  return out;
}

/**
 * Parse a Life RLE document into a `ParsedPattern`. Throws a descriptive
 * `Error` for structurally invalid input, and `UnsupportedRuleError` for a
 * well-formed but non-Conway rule.
 */
export function fromRLE(rle: string): ParsedPattern {
  const text = rle.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  let name: string | undefined;
  let author: string | undefined;
  let offsetX: number | undefined;
  let offsetY: number | undefined;
  const comments: string[] = [];

  let dimsIdx = -1;
  let width = 0;
  let height = 0;
  let ruleRaw: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;

    if (line[0] === '#') {
      const tag = line[1];
      const rest = line.slice(2).trim();
      if (tag === 'N') name = rest;
      else if (tag === 'C' || tag === 'c') comments.push(rest);
      else if (tag === 'O') author = rest;
      else if (tag === 'P' || tag === 'R') {
        const m = /(-?\d+)\D+(-?\d+)/.exec(rest);
        if (m) {
          offsetX = parseInt(m[1]!, 10);
          offsetY = parseInt(m[2]!, 10);
        }
      }
      // Unknown header tags are ignored, per spec tolerance.
      continue;
    }

    const m = /^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\s*(?:,\s*rule\s*=\s*([^\s,]+))?/i.exec(line);
    if (!m) {
      throw new Error(`fromRLE: expected a dimensions line ("x = W, y = H") but found: "${line}"`);
    }
    width = parseInt(m[1]!, 10);
    height = parseInt(m[2]!, 10);
    ruleRaw = m[3];
    dimsIdx = i;
    break;
  }

  if (dimsIdx === -1) {
    throw new Error('fromRLE: no dimensions line ("x = W, y = H") found in input');
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new Error(`fromRLE: invalid dimensions x=${width}, y=${height}`);
  }
  // Tolerate an omitted rule= clause — LifeWiki convention assumes B3/S23.
  const rule = ruleRaw ? checkRule(ruleRaw) : CONWAY_RULE_STRING;

  let body = lines.slice(dimsIdx + 1).join('');
  const bang = body.indexOf('!'); // tolerate a missing trailing '!'
  if (bang !== -1) body = body.slice(0, bang);
  body = body.replace(/\s+/g, ''); // tolerate whitespace/newlines mid-run

  const cells = parseBody(body, width, height);
  return { name: name ?? 'imported', w: width, h: height, cells, comments, author, offsetX, offsetY, rule };
}

const MAX_LINE = 70;

/** Wrap atomic RLE tokens onto lines of at most `width` chars, never splitting a token. */
function wrapTokens(tokens: readonly string[], width = MAX_LINE): string {
  const lines: string[] = [];
  let line = '';
  for (const t of tokens) {
    if (line.length > 0 && line.length + t.length > width) {
      lines.push(line);
      line = '';
    }
    line += t;
  }
  if (line.length > 0) lines.push(line);
  return lines.join('\n');
}

/**
 * Encode a `w`x`h` row-major cell buffer (1 = alive) as standard Life RLE.
 * Trims to the minimal bounding box of live cells, wraps body lines at ~70
 * columns, and preserves `name`/`meta.author`/`meta.comments` as header lines
 * so a parse → serialise → parse round-trip is stable.
 */
export function toRLE(
  cells: Uint8Array,
  rect: Pick<Rect, 'w' | 'h'>,
  name?: string,
  meta?: { comments?: string[]; author?: string; rule?: string },
): string {
  const { w, h } = rect;
  if (cells.length !== w * h) {
    throw new Error(`toRLE: cells.length (${cells.length}) !== w*h (${w * h})`);
  }
  // Always the WORLD'S ACTUAL rule (the caller's `meta.rule`, e.g.
  // `session.engine.rule`) — never a hardcoded Conway default — canonicalised
  // so a rule string round-trips through export/import identically regardless
  // of how the caller spelled it. Throws if the caller passes something this
  // engine can't actually simulate; that's a caller bug (exporting a rule
  // nothing ever validated), not a normal import-time honesty check.
  const rule = meta?.rule !== undefined ? parseRule(meta.rule).rule : CONWAY_RULE_STRING;

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const empty = maxX === -1;
  const bw = empty ? 0 : maxX - minX + 1;
  const bh = empty ? 0 : maxY - minY + 1;

  const headerLines: string[] = [];
  if (name) headerLines.push(`#N ${name}`);
  if (meta?.author) headerLines.push(`#O ${meta.author}`);
  for (const c of meta?.comments ?? []) headerLines.push(`#C ${c}`);
  headerLines.push(`x = ${bw}, y = ${bh}, rule = ${rule}`);

  const tokens: string[] = [];
  if (!empty) {
    let dollarCount = 0;
    let emitted = false;
    for (let y = minY; y <= maxY; y++) {
      if (y > minY) dollarCount++;

      const runs: string[] = [];
      let cur = -1;
      let runLen = 0;
      const flush = (): void => {
        if (cur !== -1) runs.push(`${runLen > 1 ? runLen : ''}${cur === 1 ? 'o' : 'b'}`);
      };
      for (let x = minX; x <= maxX; x++) {
        const v = cells[y * w + x] === 1 ? 1 : 0;
        if (v === cur) runLen++;
        else {
          flush();
          cur = v;
          runLen = 1;
        }
      }
      flush();
      if (runs.length > 0 && /b$/.test(runs[runs.length - 1]!)) runs.pop(); // trailing dead is implicit

      if (runs.length === 0) continue; // fully blank row — fold into next $ run

      if (emitted) tokens.push(dollarCount > 1 ? `${dollarCount}$` : '$');
      tokens.push(...runs);
      emitted = true;
      dollarCount = 0;
    }
  }
  tokens.push('!');

  return `${headerLines.join('\n')}\n${wrapTokens(tokens)}\n`;
}
