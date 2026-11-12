import { isUploadedCrossStyle } from '../shared/protocol.ts';
import type { BuiltInCrossStyle, CrossStyle, UploadedCrossStyle } from '../shared/protocol.ts';

export const crossStyles = {
  standard: { label: 'Standard', symbol: '×' },
  trollface: { label: 'Trollface', image: new URL('./assets/trollface-cross.png', import.meta.url).href },
  frog: { label: 'Frog', image: new URL('./assets/frog-cross.png', import.meta.url).href },
  poop: { label: 'Poop', symbol: '💩' },
  'the-rock': { label: 'The Rock', image: new URL('./assets/the-rock-cross.mp4', import.meta.url).href },
  knight: { label: 'Knight', image: new URL('./assets/knight-cross.png', import.meta.url).href },
} as const satisfies Record<BuiltInCrossStyle, { label: string; image: string } | { label: string; symbol: string }>;

export type CrossUpload = { style: UploadedCrossStyle; image: string };

function supportedUpload(source: unknown): source is string {
  return typeof source === 'string' && /^data:(image\/png|video\/(mp4|webm));base64,/.test(source);
}

export function readCrossUpload(): CrossUpload | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem('gridwalkers:cross-upload') ?? 'null');
    if (isUploadedCrossStyle(saved?.style) && supportedUpload(saved.image)) return saved;
  } catch { /* Ignore an unreadable preference. */ }
}

export function readCrossStyle(): CrossStyle {
  const saved = localStorage.getItem('gridwalkers:cross-style');
  if (isUploadedCrossStyle(saved) && readCrossUpload()?.style === saved) return saved;
  return saved && Object.hasOwn(crossStyles, saved) ? saved as BuiltInCrossStyle : 'standard';
}

export function crossImageSource(style: CrossStyle, uploaded?: string) {
  if (isUploadedCrossStyle(style)) return supportedUpload(uploaded) ? uploaded : undefined;
  const option = crossStyles[style];
  return option && 'image' in option ? option.image : undefined;
}

