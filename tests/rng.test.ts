import { describe, expect, it } from 'vitest';
import { Rng, hashString } from '../src/core/rng';

describe('Rng', () => {
  it('est déterministe pour une même graine', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it('accepte des graines textuelles stables', () => {
    expect(new Rng('gare:7').next()).toBe(new Rng('gare:7').next());
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('reste dans les bornes demandées', () => {
    const r = new Rng(42);
    for (let i = 0; i < 2000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('respecte grossièrement les poids de pickWeighted', () => {
    const r = new Rng(7);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i++) counts[r.pickWeighted(['a', 'b'] as const, (k) => (k === 'a' ? 3 : 1))]++;
    expect(counts.a / counts.b).toBeGreaterThan(2.4);
    expect(counts.a / counts.b).toBeLessThan(3.8);
  });
});
