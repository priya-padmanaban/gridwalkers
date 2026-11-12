import { generate } from '../shared/puzzle.ts';
import type { Puzzle } from '../shared/puzzle.ts';
import type { SettingsInput } from '../shared/protocol.ts';

import { picturePuzzle } from '../shared/pictures.ts';

export type SoloGeneration = { puzzle: Puzzle } | { error: string };

self.onmessage = ({ data }: MessageEvent<SettingsInput>) => {
  try {
    const limits = { candidates: 1600, operations: 120_000_000, ms: 4500, smallExpertFallback: '0001001110110111000110001' };
    const puzzle = picturePuzzle(data) ?? generate(data, limits, () => {});
    self.postMessage({ puzzle } satisfies SoloGeneration);
  } catch (error) {
    self.postMessage({ error: data.picture && error instanceof Error ? error.message : 'No puzzle was found for these settings. Try again for a new grid.' } satisfies SoloGeneration);
  }
};
