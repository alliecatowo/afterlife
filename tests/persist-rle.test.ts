import { describe, expect, it } from 'vitest';
import { UnsupportedRuleError, checkRule, fromRLE, toRLE } from '@/persist/store';

/** Build a row-major Uint8Array from a list of (x, y) live-cell coordinates. */
function fromCoords(coords: Array<[number, number]>, w: number, h: number): Uint8Array {
  const buf = new Uint8Array(w * h);
  for (const [x, y] of coords) buf[y * w + x] = 1;
  return buf;
}

function liveCoords(cells: Uint8Array, w: number, h: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cells[y * w + x] === 1) out.push([x, y]);
  return out;
}

// The canonical glider, one of its four rotations:
// .O.
// ..O
// OOO
const GLIDER_RLE = 'x = 3, y = 3, rule = B3/S23\nbob$2bo$3o!';
const GLIDER_COORDS: Array<[number, number]> = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];

describe('RLE import', () => {
  it('parses the canonical glider', () => {
    const p = fromRLE(GLIDER_RLE);
    expect(p.w).toBe(3);
    expect(p.h).toBe(3);
    expect(liveCoords(p.cells, p.w, p.h)).toEqual(GLIDER_COORDS);
  });

  it('tolerates CRLF line endings', () => {
    const crlf = GLIDER_RLE.replace(/\n/g, '\r\n');
    const p = fromRLE(crlf);
    expect(liveCoords(p.cells, p.w, p.h)).toEqual(GLIDER_COORDS);
  });

  it('tolerates a missing trailing "!"', () => {
    const noBang = GLIDER_RLE.replace('!', '');
    const p = fromRLE(noBang);
    expect(liveCoords(p.cells, p.w, p.h)).toEqual(GLIDER_COORDS);
  });

  it('tolerates whitespace and embedded newlines mid-run', () => {
    const messy = 'x = 3, y = 3, rule = B3/S23\nb\no b\n$2b\no$3\no !\n\n   \n';
    const p = fromRLE(messy);
    expect(liveCoords(p.cells, p.w, p.h)).toEqual(GLIDER_COORDS);
  });

  it('tolerates an omitted rule= clause, assuming B3/S23', () => {
    const p = fromRLE('x = 3, y = 3\nbob$2bo$3o!');
    expect(liveCoords(p.cells, p.w, p.h)).toEqual(GLIDER_COORDS);
  });

  it('tolerates trailing blank lines', () => {
    const p = fromRLE(`${GLIDER_RLE}\n\n\n   \n`);
    expect(liveCoords(p.cells, p.w, p.h)).toEqual(GLIDER_COORDS);
  });

  it('parses #N/#C/#O header lines', () => {
    const withHeader = '#N Glider\n#O Richard K. Guy\n#C The smallest, most common spaceship.\n' + GLIDER_RLE;
    const p = fromRLE(withHeader);
    expect(p.name).toBe('Glider');
    expect(p.author).toBe('Richard K. Guy');
    expect(p.comments).toEqual(['The smallest, most common spaceship.']);
  });

  describe('rule handling', () => {
    it('accepts common Conway rule spellings', () => {
      for (const rule of ['B3/S23', 'b3/s23', '23/3', 'S23/B3']) {
        expect(() => checkRule(rule)).not.toThrow();
        expect(checkRule(rule)).toBe('B3/S23');
      }
    });

    it('defaults an omitted rule= clause to B3/S23', () => {
      const p = fromRLE('x = 3, y = 3\nbob$2bo$3o!');
      expect(p.rule).toBe('B3/S23');
    });

    it('accepts HighLife (B36/S23) and sets the world\'s rule accordingly', () => {
      const highlife = 'x = 3, y = 3, rule = B36/S23\nbob$2bo$3o!';
      const p = fromRLE(highlife);
      expect(p.rule).toBe('B36/S23');
      expect(liveCoords(p.cells, p.w, p.h)).toEqual(GLIDER_COORDS);
    });

    it('accepts Seeds (B2/S) too, and canonicalises messy spellings', () => {
      const p = fromRLE('x = 1, y = 1, rule = b2/s\no!');
      expect(p.rule).toBe('B2/S');
    });

    it('rejects a Generations rule (3+ slash segments), naming what was found', () => {
      const generations = 'x = 3, y = 3, rule = B3/S23/3\nbob$2bo$3o!';
      expect(() => fromRLE(generations)).toThrow(UnsupportedRuleError);
      try {
        fromRLE(generations);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedRuleError);
        expect((err as UnsupportedRuleError).rawRule).toBe('B3/S23/3');
        expect((err as Error).message).toMatch(/Generations/i);
      }
    });

    it('rejects Hensel (non-totalistic) notation, naming it', () => {
      const hensel = 'x = 3, y = 3, rule = B2n3/S23-a4i\nbob$2bo$3o!';
      expect(() => fromRLE(hensel)).toThrow(UnsupportedRuleError);
      try {
        fromRLE(hensel);
        expect.unreachable();
      } catch (err) {
        expect((err as Error).message).toMatch(/Hensel/i);
      }
    });

    it('rejects a Larger-than-Life / non-Moore neighbourhood specifier, naming it', () => {
      const ltl = 'x = 3, y = 3, rule = R2,C0,S6..12,B7..12,NM\nbob$2bo$3o!';
      expect(() => fromRLE(ltl)).toThrow(UnsupportedRuleError);
      try {
        fromRLE(ltl);
        expect.unreachable();
      } catch (err) {
        expect((err as Error).message).toMatch(/Larger-than-Life|neighbourhood/i);
      }
    });
  });
});

describe('RLE round-trip', () => {
  it('glider: parse -> serialise -> parse is cell-identical', () => {
    const p1 = fromRLE(GLIDER_RLE);
    const text = toRLE(p1.cells, { w: p1.w, h: p1.h }, p1.name);
    const p2 = fromRLE(text);
    expect(p2.w).toBe(p1.w);
    expect(p2.h).toBe(p1.h);
    expect(Array.from(p2.cells)).toEqual(Array.from(p1.cells));
  });

  it('preserves name, author and comments through a round-trip', () => {
    const p1 = fromRLE(`#N Glider\n#O Conway\n#C line one\n#C line two\n${GLIDER_RLE}`);
    const text = toRLE(p1.cells, { w: p1.w, h: p1.h }, p1.name, { author: p1.author, comments: p1.comments });
    const p2 = fromRLE(text);
    expect(p2.name).toBe('Glider');
    expect(p2.author).toBe('Conway');
    expect(p2.comments).toEqual(['line one', 'line two']);
    expect(Array.from(p2.cells)).toEqual(Array.from(p1.cells));
  });

  it('a wide pattern line-wraps at ~70 columns and still round-trips', () => {
    const w = 200;
    const h = 1;
    const coords: Array<[number, number]> = [];
    for (let x = 0; x < w; x += 2) coords.push([x, 0]); // alternating -> maximally verbose RLE
    coords.push([w - 1, 0]); // ensure the bounding box spans the full declared width
    const cells = fromCoords(coords, w, h);

    const text = toRLE(cells, { w, h });
    const bodyLines = text.split('\n').slice(1, -1); // drop header + trailing blank
    expect(bodyLines.length).toBeGreaterThan(1);
    for (const line of bodyLines) expect(line.length).toBeLessThanOrEqual(70);

    const parsed = fromRLE(text);
    expect(Array.from(parsed.cells)).toEqual(Array.from(cells));

    // Idempotent: re-serialising the parsed pattern reproduces the same text.
    const text2 = toRLE(parsed.cells, { w: parsed.w, h: parsed.h });
    expect(text2).toBe(text);
  });

  it('round-trips a pulsar-sized symmetric oscillator (13x13, multi-row blank gaps)', () => {
    // Standard 4-fold-symmetric pulsar layout.
    const bars = [
      [2, 3, 4], [8, 9, 10],
    ].flat();
    const rows = [0, 5, 7, 12];
    const coords: Array<[number, number]> = [];
    for (const y of rows) for (const x of bars) coords.push([x, y]);
    const cols = [0, 5, 7, 12];
    const barsV = [2, 3, 4, 8, 9, 10];
    for (const x of cols) for (const y of barsV) coords.push([x, y]);

    const w = 13, h = 13;
    const cells = fromCoords(coords, w, h);
    const text = toRLE(cells, { w, h }, 'Pulsar');
    const parsed = fromRLE(text);
    expect(Array.from(parsed.cells)).toEqual(Array.from(cells));
    const text2 = toRLE(parsed.cells, { w: parsed.w, h: parsed.h }, parsed.name);
    expect(text2).toBe(text);
  });

  it('round-trips a Gosper-Gun-sized sparse multi-row pattern (36x9, several components)', () => {
    // Not claimed to be bit-for-bit the canonical gun — exercises multiple
    // disjoint components, blank-row runs, and moderate width in one shape.
    const coords: Array<[number, number]> = [
      [24, 0],
      [22, 1], [24, 1],
      [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
      [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
      [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
      [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [23, 5],
      [10, 6], [16, 6],
      [11, 7], [15, 7],
      [12, 8], [13, 8],
    ];
    const w = 36, h = 9;
    const cells = fromCoords(coords, w, h);
    const text = toRLE(cells, { w, h }, 'Gun-shaped fixture');
    const parsed = fromRLE(text);
    expect(parsed.w).toBe(w);
    expect(parsed.h).toBe(h);
    expect(Array.from(parsed.cells)).toEqual(Array.from(cells));
    const text2 = toRLE(parsed.cells, { w: parsed.w, h: parsed.h }, parsed.name);
    expect(text2).toBe(text);
  });

  it('trims to the minimal bounding box on export', () => {
    // A single live cell in the middle of a much larger declared rect.
    const w = 20, h = 20;
    const cells = fromCoords([[10, 10]], w, h);
    const text = toRLE(cells, { w, h });
    expect(text).toMatch(/x = 1, y = 1, rule = B3\/S23/);
  });

  describe('a non-Conway rule round-trips honestly (export writes the WORLD\'S actual rule)', () => {
    const rules = ['B36/S23', 'B2/S', 'B3678/S34678', 'B1357/S1357', 'S23/B3'];
    for (const rule of rules) {
      it(`glider-shaped fixture under "${rule}"`, () => {
        const p1 = fromRLE(GLIDER_RLE.replace('rule = B3/S23', `rule = ${rule}`));
        const text = toRLE(p1.cells, { w: p1.w, h: p1.h }, p1.name, { rule: p1.rule });
        expect(text).toMatch(new RegExp(`rule = ${p1.rule.replace('/', '\\/')}`));
        const p2 = fromRLE(text);
        expect(p2.rule).toBe(p1.rule);
        expect(Array.from(p2.cells)).toEqual(Array.from(p1.cells));
      });
    }
  });

  it('toRLE defaults to B3/S23 when no rule is given (never silently writes a caller-supplied one it did not validate)', () => {
    const cells = fromCoords([[0, 0]], 1, 1);
    expect(toRLE(cells, { w: 1, h: 1 })).toMatch(/rule = B3\/S23/);
  });

  it('toRLE throws for a rule it cannot simulate — a caller bug, not an import-time honesty check', () => {
    const cells = fromCoords([[0, 0]], 1, 1);
    expect(() => toRLE(cells, { w: 1, h: 1 }, undefined, { rule: 'B3/S23/3' })).toThrow();
  });
});
