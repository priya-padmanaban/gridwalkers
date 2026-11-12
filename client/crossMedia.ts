import { crossUploadMaxBytes } from '../shared/protocol.ts';
import type { UploadedCrossStyle } from '../shared/protocol.ts';
import type { CrossUpload } from './crossStyles.ts';

export function isVideoCrossSource(source: string) {
  return /^data:video\/(mp4|webm);base64,/.test(source) || /\.(mp4|webm)$/i.test(source);
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function createVideo(source: string) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = source;
  return video;
}

function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function waitForVideo(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', failed);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('Choose a video your browser can play.'));
    const timeout = setTimeout(failed, 5000);
    video.addEventListener('loadeddata', ready, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

export async function prepareCrossUpload(file: File): Promise<CrossUpload> {
  const video = file.type === 'video/mp4' || file.type === 'video/webm';
  if (!video && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, MP4, or WebM file.');
  }
  let image: string;
  if (video) {
    if (file.size > crossUploadMaxBytes) throw new Error('Choose a video up to 512 KB.');
    const url = URL.createObjectURL(file);
    const preview = createVideo(url);
    try {
      await waitForVideo(preview);
      if (!preview.videoWidth) throw new Error('Choose a file with a video track.');
      image = await dataUrl(file);
    } finally {
      releaseVideo(preview);
      URL.revokeObjectURL(url);
    }
  } else {
    if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image under 8 MB.');
    const signature = new TextDecoder().decode(await file.slice(0, 6).arrayBuffer());
    if (/^GIF8[79]a$/.test(signature)) throw new Error('Choose a PNG, JPEG, WebP, MP4, or WebM file.');
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
type CrossMedia = { frame(reduced: boolean): CrossFrame | undefined; dispose(): void };

export function loadCrossMedia(source: string): CrossMedia {
  if (isVideoCrossSource(source)) {
    const video = createVideo(source);
    video.loop = true;
    let playing = false;
    return {
      frame(reduced) {
        if (playing === reduced) {
          playing = !reduced;
          if (playing) void video.play().catch(() => {});
          else video.pause();
        }
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
          return { image: video, width: video.videoWidth, height: video.videoHeight };
        }
      },
      dispose: () => releaseVideo(video),
    };
  }
  const image = new Image();
  image.src = source;
  return {
    frame: () => image.naturalWidth ? { image, width: image.naturalWidth, height: image.naturalHeight } : undefined,
    dispose: () => image.removeAttribute('src'),
  };
}

export async function videoPoster(source: string) {
  const video = createVideo(source);
  try {
    await waitForVideo(video);
    if (!video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 96 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL();
  } finally {
    releaseVideo(video);
  }
}
