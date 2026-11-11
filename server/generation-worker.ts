import { parentPort, workerData } from 'node:worker_threads';
import { generate } from './puzzle.ts';
try {
  const puzzle = generate(workerData.settings, workerData.limits, progress => parentPort?.postMessage({ progress }));
  parentPort?.postMessage({ puzzle });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : 'Generation failed.' });
}
