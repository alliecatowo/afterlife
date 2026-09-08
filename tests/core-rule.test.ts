import { describe, expect, it } from 'vitest';
import { CONWAY_RULE_STRING, RuleParseError, isValidRuleString, parseRule, ruleStringsEqual, serializeRule } from '@/core/rule';

describe('parseRule: accepted variants round-trip to the canonical form', () => {
  const cases: Array<[string, string]> = [
    ['B3/S23', 'B3/S23'],
    ['b3/s23', 'B3/S23'],
    ['S23/B3', 'B3/S23'],
    ['s23/b3', 'B3/S23'],
    ['23/3', 'B3/S23'], // Life 1.05: survive/birth, no letters
    ['  B3/S23  ', 'B3/S23'],
    ['B63/S32', 'B36/S23'], // digits deduped + sorted regardless of input order
    ['B33/S223', 'B3/S23'], // duplicate digits collapse
    ['B36/S23', 'B36/S23'], // HighLife
    ['B2/S', 'B2/S'], // Seeds: empty survive group
    ['B/S8', 'B/S8'], // empty birth group
    ['B3678/S34678', 'B3678/S34678'], // Day & Night
    ['B1357/S1357', 'B1357/S1357'], // Replicator
    ['B3/S012345678', 'B3/S012345678'], // Life without Death
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" -> "${expected}"`, () => {
      const rule = parseRule(input);
      expect(serializeRule(rule)).toBe(expected);
      expect(rule.rule).toBe(expected);
    });
  }

  it('CONWAY_RULE_STRING is the canonical Conway spelling', () => {
    expect(CONWAY_RULE_STRING).toBe('B3/S23');
    expect(parseRule(CONWAY_RULE_STRING).isConway).toBe(true);
  });

  it('isConway is true for any spelling of the same digit sets', () => {
    expect(parseRule('S23/B3').isConway).toBe(true);
    expect(parseRule('B3/S32').isConway).toBe(true);
    expect(parseRule('B36/S23').isConway).toBe(false);
  });

  it('ruleStringsEqual compares canonical form, not spelling', () => {
    expect(ruleStringsEqual('B3/S23', 'S23/B3')).toBe(true);
    expect(ruleStringsEqual('b63/s32', 'B36/S23')).toBe(true);
    expect(ruleStringsEqual('B3/S23', 'B36/S23')).toBe(false);
  });

  it('isValidRuleString never throws, true for good input, false for bad', () => {
    expect(isValidRuleString('B3/S23')).toBe(true);
    expect(isValidRuleString('nonsense')).toBe(false);
  });
});

describe('parseRule: lookup table matches hand-computed B3/S23 exactly', () => {
  it('birth only at n===3, survive only at n===2 or n===3', () => {
    const { table } = parseRule('B3/S23');
    for (let n = 0; n <= 8; n++) {
      const wasDead = table[0 * 9 + n];
      const wasAlive = table[1 * 9 + n];
      expect(wasDead).toBe(n === 3 ? 1 : 0);
      expect(wasAlive).toBe(n === 2 || n === 3 ? 1 : 0);
    }
  });

  it('HighLife (B36/S23) table adds birth at n===6', () => {
    const { table } = parseRule('B36/S23');
    for (let n = 0; n <= 8; n++) {
      expect(table[0 * 9 + n]).toBe(n === 3 || n === 6 ? 1 : 0);
      expect(table[1 * 9 + n]).toBe(n === 2 || n === 3 ? 1 : 0);
    }
  });

  it('Seeds (B2/S) never survives, only births at n===2', () => {
    const { table } = parseRule('B2/S');
    for (let n = 0; n <= 8; n++) {
      expect(table[0 * 9 + n]).toBe(n === 2 ? 1 : 0);
      expect(table[1 * 9 + n]).toBe(0);
    }
  });

  it('Life without Death (B3/S012345678) never lets a live cell die', () => {
    const { table } = parseRule('B3/S012345678');
    for (let n = 0; n <= 8; n++) {
      expect(table[1 * 9 + n]).toBe(1);
    }
  });
});

describe('parseRule: rejects genuinely unsupported rule families with a clear message', () => {
  it('rejects empty input', () => {
    expect(() => parseRule('')).toThrow(RuleParseError);
    expect(() => parseRule('   ')).toThrow(RuleParseError);
  });

  it('rejects nonsense', () => {
    expect(() => parseRule('not a rule')).toThrow(RuleParseError);
  });

  it('rejects a neighbour count above 8', () => {
    try {
      parseRule('B9/S23');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuleParseError);
      expect((err as RuleParseError).message).toMatch(/0\.\.8|Moore/);
    }
  });

  it('rejects Generations rules (3+ slash-separated segments), naming what was found', () => {
    try {
      parseRule('B3/S23/3');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuleParseError);
      expect((err as RuleParseError).message).toMatch(/Generations/i);
    }
  });

  it('rejects Hensel (non-totalistic) notation, naming it', () => {
    try {
      parseRule('B2n3/S23-a4i');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuleParseError);
      expect((err as RuleParseError).message).toMatch(/Hensel/i);
    }
  });

  it('rejects Larger-than-Life / range-neighbourhood specifiers, naming it', () => {
    try {
      parseRule('R2,C0,S6..12,B7..12,NM');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuleParseError);
      expect((err as RuleParseError).message).toMatch(/Larger-than-Life|neighbourhood/i);
    }
  });

  it('the error names the raw input that was rejected', () => {
    try {
      parseRule('garbage-rule');
      expect.unreachable();
    } catch (err) {
      expect((err as RuleParseError).rawRule).toBe('garbage-rule');
    }
  });
});
