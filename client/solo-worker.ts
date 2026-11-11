import { generate } from '../shared/puzzle.ts';
import type { Puzzle } from '../shared/puzzle.ts';
import type { Settings } from '../shared/protocol.ts';

export type SoloGeneration = { puzzle: Puzzle } | { error: string };

self.onmessage = ({ data }: MessageEvent<Settings>) => {
  try {
    const limits = { candidates: 1600, operations: 120_000_000, ms: 4500, smallExpertFallback: '0001001110110111000110001' };
    const puzzle = generate(data, limits, () => {});
    self.postMessage({ puzzle } satisfies SoloGeneration);
  } catch {
    self.postMessage({ error: 'No puzzle was found for these settings. Try again for a new grid.' } satisfies SoloGeneration);
  }
};
