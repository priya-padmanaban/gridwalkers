import type { Difficulty, Settings } from '../shared/protocol.ts';

export type Puzzle = { solution: number[]; rows: number[][]; columns: number[][] };
export type Metrics = { passes: number; initial: number; deductions: number; revealed: number[]; slow: number; chain: number };
export function clues(line: number[]): number[] {
  const runs: number[] = [];
  let length = 0;
  for (const cell of [...line, 0]) {
    if (cell === 1) length++;
    else if (length) { runs.push(length); length = 0; }
  }
  return runs.length ? runs : [0];
}

export function describe(solution: number[], width: number, height: number): Puzzle {
  return {
    solution,
    rows: Array.from({ length: height }, (_, y) => clues(solution.slice(y * width, (y + 1) * width))),
    columns: Array.from({ length: width }, (_, x) => clues(Array.from({ length: height }, (_, y) => solution[y * width + x]))),
  };
}

// A path through (position, run index) describes one valid arrangement.
export function analyze(line: number[], clue: number[], locateRuns = false) {
  const n = line.length;
  const runs = clue[0] === 0 ? [] : clue;
  const stride = runs.length + 1;
  const size = (n + 1) * stride;
  const start = new Uint8Array(size);
  const end = new Uint8Array(size);
  const runNext = new Int32Array(size).fill(-1);
  const blocked = new Uint8Array(n + 1);
  for (let p = 0; p < n; p++) blocked[p + 1] = blocked[p] + Number(line[p] === 0);
  end[size - 1] = 1;
  for (let p = n - 1; p >= 0; p--) {
    for (let r = 0; r < stride; r++) {
      const i = p * stride + r;
      const stop = p + runs[r];
      if (stop <= n && blocked[p] === blocked[stop] && (stop === n || line[stop] !== 1)) {
        runNext[i] = (stop < n ? stop + 1 : stop) * stride + r + 1;
      }
      end[i] = Number((line[p] !== 1 && end[i + stride]) || (runNext[i] >= 0 && end[runNext[i]]));
    }
  }
  if (!end[0]) return null;
  const masks = new Uint8Array(n);
  const filled = new Int16Array(n + 1);
  const placements = locateRuns ? Array.from({ length: runs.length }, () => new Set<number>()) : [];
  start[0] = 1;
  for (let p = 0; p < n; p++) {
    for (let r = 0; r < stride; r++) {
      const i = p * stride + r;
      if (!start[i]) continue;
      if (line[p] !== 1 && end[i + stride]) { start[i + stride] = 1; masks[p] |= 1; }
      const next = runNext[i];
      if (next < 0 || !end[next]) continue;
      start[next] = 1;
      if (locateRuns) placements[r].add(p);
      const stop = p + runs[r];
      filled[p]++;
      filled[stop]--;
      if (stop < n) masks[stop] |= 1;
    }
  }
  let coverage = 0;
  for (let p = 0; p < n; p++) {
    coverage += filled[p];
    if (coverage) masks[p] |= 2;
  }
  return { forced: Array.from(masks, mask => mask === 1 ? 0 : mask === 2 ? 1 : -1), placements };
}

export class Budget {
  remaining: number;
  deadline: number;
  constructor(operations: number, deadline: number) {
    this.remaining = operations;
    this.deadline = deadline;
  }
  spend(cost: number) {
    this.remaining -= cost;
    if (this.remaining < 0 || Date.now() >= this.deadline) throw new Error('Puzzle generation budget exhausted.');
  }
}

export function solve(puzzle: Pick<Puzzle, 'rows' | 'columns'>, budget: Budget, seed?: number[]) {
  const w = puzzle.columns.length;
  const h = puzzle.rows.length;
  const cells = seed ? [...seed] : Array<number>(w * h).fill(-1);
  const depths = cells.map(() => 0);
  const metrics: Metrics = { passes: 0, initial: 0, deductions: 0, revealed: [], slow: 0, chain: 0 };
  const lines = [...puzzle.rows, ...puzzle.columns].map((clue, i) => ({
    clue, indices: Array.from({ length: i < h ? w : h }, (_, j) => i < h ? i * w + j : j * w + i - h),
  }));
  let dirty = new Set(lines.keys());
  while (dirty.size) {
    const next = new Set<number>();
    const pending = new Map<number, [number, number]>();
    for (const i of dirty) {
      const { clue, indices } = lines[i];
      budget.spend(indices.length * (clue.length + 1));
      const analysis = analyze(indices.map(j => cells[j]), clue);
      if (!analysis) return null;
      const depth = 1 + Math.max(...indices.map(j => depths[j]));
      for (const [offset, value] of analysis.forced.entries()) {
        const j = indices[offset];
        if (value === -1 || cells[j] !== -1) continue;
        const other = pending.get(j);
        if (other && other[0] !== value) return null;
        pending.set(j, [value, Math.min(depth, other?.[1] ?? depth)]);
      }
    }
    if (!pending.size) break;
    if (!metrics.passes) metrics.initial = pending.size / cells.length;
    metrics.passes++;
    metrics.revealed.push(pending.size);
    metrics.deductions += pending.size;
    if (pending.size / cells.length < 0.04) metrics.slow++;
    for (const [j, [value, depth]] of pending) {
      cells[j] = value;
      depths[j] = depth;
      metrics.chain = Math.max(metrics.chain, depth);
      next.add(Math.floor(j / w));
      next.add(h + j % w);
    }
    dirty = next;
  }
  return { cells, metrics };
}

export function countSolutions(puzzle: Pick<Puzzle, 'rows' | 'columns'>, budget: Budget): number {
  const stack: (number[] | undefined)[] = [undefined];
  let count = 0;
  while (stack.length && count < 2) {
    budget.spend(1);
    const result = solve(puzzle, budget, stack.pop());
    if (!result) continue;
    const index = result.cells.indexOf(-1);
    if (index === -1) { count++; continue; }
    const other = [...result.cells];
    result.cells[index] = 0;
    other[index] = 1;
    stack.push(other, result.cells);
  }
  return count;
}

export function score(metrics: Metrics) {
  return (1 - metrics.initial) * 32 + metrics.passes * 2.1 + metrics.chain * 1.2 + metrics.slow * 0.7;
}

export function classify(metrics: Metrics): Difficulty {
  const points = score(metrics);
  if (points < 22) return 'easy';
  if (points < 37) return 'medium';
  if (points < 54) return 'hard';
  return 'expert';
}

function candidate(w: number, h: number, difficulty: Difficulty, attempt: number, random: () => number) {
  const count = Math.floor(3 + random() * (difficulty === 'expert' ? 9 : 6));
  const blobs = Array.from({ length: count }, () => ({
    x: random(), y: random(), weight: random() * 0.6 + 0.5,
    rx: 0.12 + random() * 0.36, ry: 0.12 + random() * 0.36,
  }));
  const mirror = attempt % 7 === 0;
  const thresholds = { easy: 0.29, medium: 0.44, hard: 0.54, expert: 0.61 };
  const threshold = thresholds[difficulty] + (random() - 0.5) * 0.28;
  return Array.from({ length: w * h }, (_, i) => {
    const rawX = (i % w + 0.5) / w;
    const x = mirror ? Math.min(rawX, 1 - rawX) * 2 : rawX;
    const y = (Math.floor(i / w) + 0.5) / h;
    const field = blobs.reduce((sum, b) => sum + b.weight * Math.exp(-(((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2)), 0);
    const noise = attempt % 3 === 0 ? (random() - 0.5) * (w * h <= 80 ? 0.82 : 0.27) : 0;
    return Number(field + noise > threshold);
  });
}

export function generate(settings: Settings, limits: { candidates: number; operations: number; ms: number }, progress: (value: number) => void, random = Math.random): Puzzle {
  const { width, height, difficulty } = settings;
  const budget = new Budget(limits.operations, Date.now() + limits.ms);
  for (let i = 0; i < limits.candidates; i++) {
    budget.spend(width * height);
    if (i % 16 === 0) progress(Math.min(95, 5 + Math.floor(i / limits.candidates * 90)));
    const solution = candidate(width, height, difficulty, i, random);
    const fills = solution.reduce((sum, cell) => sum + cell, 0);
    if (fills < solution.length * 0.12 || fills > solution.length * 0.88) continue;
    const puzzle = describe(solution, width, height);
    const logical = solve(puzzle, budget);
    if (!logical || logical.cells.includes(-1) || classify(logical.metrics) !== difficulty) continue;
    if (countSolutions(puzzle, budget) === 1) return puzzle;
  }
  // This curated small expert puzzle is verified by the same solvers.
  if (width === 5 && height === 5 && difficulty === 'expert') {
    const solution = Array.from('1100010110000110110001100', Number);
    const puzzle = describe(random() < 0.5 ? solution : solution.reverse(), width, height);
    const logical = solve(puzzle, budget);
    if (logical && !logical.cells.includes(-1) && classify(logical.metrics) === difficulty && countSolutions(puzzle, budget) === 1) return puzzle;
  }
  throw new Error('No puzzle met this difficulty within the generation budget.');
}
