import { parentPort, workerData } from 'node:worker_threads';
import { generate } from '../shared/puzzle.ts';
try {
  const limits = { ...workerData.limits, smallExpertFallback: '1100010110000110110001100' };
  const puzzle = generate(workerData.settings, limits, progress => parentPort?.postMessage({ progress }));
  parentPort?.postMessage({ puzzle });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : 'Generation failed.' });
}
