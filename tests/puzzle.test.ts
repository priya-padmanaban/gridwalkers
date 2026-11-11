import { describe as suite, expect, it } from 'vitest';
import { analyze, Budget, classify, clues, countSolutions, describe, generate, solve } from '../server/puzzle.ts';
import { difficulties, defaultSettings } from '../shared/protocol.ts';

const budget = () => new Budget(120_000_000, Date.now() + 6000);
const read = (text: string) => [...text].map(Number);
const randomFrom = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

suite('line deductions', () => {
  it('builds empty, full, and mixed clues', () => {
    expect(clues(read('00000'))).toEqual([0]);
    expect(clues(read('11111'))).toEqual([5]);
    expect(clues(read('0111011001'))).toEqual([3, 2, 1]);
  });

  it('agrees with enumeration on short lines with known marks', () => {
    const random = randomFrom(37);
    for (let size = 1; size <= 7; size++) {
      const solutions = Array.from({ length: 2 ** size }, (_, i) => read(i.toString(2).padStart(size, '0')));
      for (let trial = 0; trial < 70; trial++) {
        const line = Array.from({ length: size }, () => Math.floor(random() * 3) - 1);
        const clue = clues(solutions[Math.floor(random() * solutions.length)]);
        const valid = solutions.filter(s => clues(s).join() === clue.join() && s.every((cell, i) => line[i] < 0 || line[i] === cell));
        const result = analyze(line, clue);
        if (!valid.length) expect(result).toBeNull();
        else expect(result?.forced).toEqual(line.map((_, i) => valid.every(s => s[i] === valid[0][i]) ? valid[0][i] : -1));
      }
    }
  });
});

suite('puzzle validation and generation', () => {
  it('propagates on a rectangular grid and at maximum size', () => {
    for (const [width, height] of [[5, 7], [60, 60]]) {
      const solution = Array.from({ length: width * height }, (_, i) => Number(i % width < Math.floor(width / 2)));
      const puzzle = describe(solution, width, height);
      expect(puzzle.rows.length).toBe(height);
      expect(puzzle.columns.length).toBe(width);
      expect(solve(puzzle, budget())?.cells).toEqual(solution);
      expect(countSolutions(puzzle, budget())).toBe(1);
    }
  });

  it('counts up to two, and rejects inconsistent clues', () => {
    const ambiguous = { rows: [[1], [1]], columns: [[1], [1]] };
    expect(solve(ambiguous, budget())?.cells).toEqual([-1, -1, -1, -1]);
    expect(countSolutions(ambiguous, budget())).toBe(2);
    expect(countSolutions({ rows: [[0], [0]], columns: [[0], [1]] }, budget())).toBe(0);
    expect(() => countSolutions(ambiguous, new Budget(1, Date.now() + 5000))).toThrow(/budget/);
  });

  it.each(difficulties)('generates a logically solved and unique %s puzzle', difficulty => {
    for (const [width, height] of [[5, 5], [13, 17], [60, 60]]) {
      const settings = { ...defaultSettings, width, height, difficulty };
      const puzzle = generate(settings, { candidates: 1600, operations: 120_000_000, ms: 4500 }, () => {}, randomFrom(85));
      const result = solve(puzzle, budget())!;
      expect(result.cells).toEqual(puzzle.solution);
      expect(classify(result.metrics)).toBe(difficulty);
      expect(result.metrics.deductions).toBe(width * height);
      expect(countSolutions(puzzle, budget())).toBe(1);
    }
  });
});
