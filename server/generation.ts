import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import type { Settings } from '../shared/protocol.ts';
import type { Puzzle } from './puzzle.ts';

export function generateAsync(settings: Settings, progress: (value: number) => void): Promise<Puzzle> {
  const limits = {
    candidates: Number(process.env.GENERATION_CANDIDATES) || 1600,
    operations: Number(process.env.GENERATION_OPERATIONS) || 120_000_000,
    ms: Number(process.env.GENERATION_MS) || 4500,
  };
  return new Promise((resolvePuzzle, reject) => {
    const workerPath = process.env.VERCEL
      ? 'server-build/generation-worker.cjs'
      : 'server/generation-worker.ts';
    const worker = new Worker(resolve(workerPath), {
      workerData: { settings, limits }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    });
    const timeout = setTimeout(() => {
      reject(new Error('Generation took too long. Try again.'));
      void worker.terminate();
    }, limits.ms + 1500);
    worker.on('message', message => {
      if (typeof message.progress === 'number') progress(message.progress);
      if (message.puzzle) resolvePuzzle(message.puzzle);
      if (message.error) reject(new Error(message.error));
    });
    worker.once('error', reject);
    worker.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('Generation ended unexpectedly.'));
    });
  });
}
