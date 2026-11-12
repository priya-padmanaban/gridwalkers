import { decompressFrame, parseGIF } from 'gifuct-js';
import { crossUploadMaxBytes, crossUploadMaxDimension } from '../shared/protocol.ts';
import type { UploadedCrossStyle } from '../shared/protocol.ts';
import type { CrossUpload } from './crossStyles.ts';

function readGif(bytes: ArrayBuffer) {
  const gif = parseGIF(bytes);
  const { width, height } = gif.lsd;
  const frames = gif.frames.filter(frame => 'image' in frame);
  if (gif.header.signature !== 'GIF' || !width || !height || width > crossUploadMaxDimension ||
      height > crossUploadMaxDimension || !frames.length || frames.some(({ image: { descriptor } }) =>
        !descriptor.width || !descriptor.height || descriptor.left + descriptor.width > width ||
        descriptor.top + descriptor.height > height)) {
    throw new Error('Use a valid GIF up to 512 × 512 pixels.');
  }
  return { gif, frames };
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function prepareCrossUpload(file: File): Promise<CrossUpload> {
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image under 8 MB.');
  if (!['image/gif', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, or GIF image.');
  }
  let image: string;
  if (file.type === 'image/gif') {
    if (file.size > crossUploadMaxBytes) throw new Error('Choose a GIF up to 256 KB.');
    readGif(await file.arrayBuffer());
    image = await dataUrl(file);
  } else {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 224 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      image = canvas.toDataURL('image/png');
    } finally {
      bitmap.close();
    }
  }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(image));
  const style: UploadedCrossStyle = `upload:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return { style, image };
}

type CrossFrame = { image: CanvasImageSource; width: number; height: number };

export function loadCrossMedia(source: string): (now: number, reduced: boolean) => CrossFrame | undefined {
  const image = new Image();
  image.src = source;
  let animate: ((now: number, reduced: boolean) => CrossFrame) | undefined;
  if (source.startsWith('data:image/gif;') || source.endsWith('.gif')) {
    void fetch(source).then(response => response.arrayBuffer()).then(bytes => {
      const { gif, frames } = readGif(bytes);
      const { width, height } = gif.lsd;
      const canvas = document.createElement('canvas');
      const tile = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      const tileContext = tile.getContext('2d')!;
      let index = 0;
      let nextAt = -Infinity;
      let previous: ReturnType<typeof decompressFrame> | undefined;
      let restore: ImageData | undefined;
      animate = (now, reduced) => {
        if ((!previous || !reduced) && now >= nextAt) {
          if (index === 0) context.clearRect(0, 0, width, height);
          else if (previous?.disposalType === 2) {
            const rect = previous.dims;
            context.clearRect(rect.left, rect.top, rect.width, rect.height);
          } else if (previous?.disposalType === 3 && restore) {
            context.putImageData(restore, previous.dims.left, previous.dims.top);
          }
          const frame = decompressFrame(frames[index], gif.gct, true);
          const rect = frame.dims;
          restore = frame.disposalType === 3 ? context.getImageData(rect.left, rect.top, rect.width, rect.height) : undefined;
          tile.width = rect.width;
          tile.height = rect.height;
          tileContext.putImageData(new ImageData(new Uint8ClampedArray(frame.patch), rect.width, rect.height), 0, 0);
          context.drawImage(tile, rect.left, rect.top);
          previous = frame;
          nextAt = now + Math.max(30, frame.delay || 100);
          index = (index + 1) % frames.length;
        }
        return { image: canvas, width, height };
      };
    }).catch(() => {});
  }
  return (now, reduced) => {
    if (animate) {
      try { return animate(now, reduced); }
      catch { animate = undefined; }
    }
    if (image.naturalWidth) return { image, width: image.naturalWidth, height: image.naturalHeight };
  };
}
