import { maxImageGrid } from '../shared/pictures.ts';

export type ImageGrid = { width: number; height: number; scores: number[]; cutoff: number; inverted: boolean; alpha: boolean };

export function samplePicture(bitmap: ImageBitmap, longestSide: number): ImageGrid {
  const scale = longestSide / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(5, Math.round(bitmap.width * scale));
  const height = Math.max(5, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const drawnWidth = Math.max(1, Math.round(bitmap.width * scale));
  const drawnHeight = Math.max(1, Math.round(bitmap.height * scale));
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(bitmap, Math.floor((width - drawnWidth) / 2), Math.floor((height - drawnHeight) / 2), drawnWidth, drawnHeight);
  const { data } = ctx.getImageData(0, 0, width, height);
  const pixels = Array.from({ length: width * height }, (_, i) => data.subarray(i * 4, i * 4 + 4));
  const alpha = pixels.some(pixel => pixel[3] < 128) && pixels.some(pixel => pixel[3] >= 128);
  const scores = pixels.map(([r, g, b, a]) => {
    if (alpha) return a;
    const value = Math.max(r, g, b);
    const saturation = value ? (value - Math.min(r, g, b)) / value : 0;
    return Math.round(value * (1 - 0.35 * saturation) * a / 255 + 255 - a);
  });
  const cutoff = alpha ? 128 : otsuCutoff(scores);
  const edges = scores.filter((_, index) => index < width || index >= width * (height - 1) || index % width === 0 || index % width === width - 1);
  const inverted = !alpha && edges.filter(score => score >= cutoff).length > edges.length / 2;
  return { width, height, scores, cutoff, inverted, alpha };
}

function otsuCutoff(scores: number[]) {
  const histogram = Array<number>(256).fill(0);
  for (const score of scores) histogram[score]++;
  const total = scores.reduce((sum, score) => sum + score, 0);
  let lowerCount = 0;
  let lowerSum = 0;
  let best = -1;
  let first = 128;
  let last = 128;
  for (let cutoff = 1; cutoff <= 255; cutoff++) {
    lowerCount += histogram[cutoff - 1];
    lowerSum += histogram[cutoff - 1] * (cutoff - 1);
    const upperCount = scores.length - lowerCount;
    if (!lowerCount || !upperCount) continue;
    const difference = lowerSum / lowerCount - (total - lowerSum) / upperCount;
    const separation = lowerCount * upperCount * difference ** 2;
    if (separation > best) {
      best = separation;
      first = cutoff;
    }
    if (separation === best) last = cutoff;
  }
  return Math.round((first + last) / 2);
}

export function imageMask(grid: ImageGrid) {
  return grid.scores.map(score => Number((score >= grid.cutoff) !== grid.inverted)).join('');
}

export function imageGridSize(bitmap: ImageBitmap) {
  return Math.max(5, Math.min(maxImageGrid, Math.max(bitmap.width, bitmap.height)));
}
