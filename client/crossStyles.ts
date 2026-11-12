import type { CrossStyle } from '../shared/protocol.ts';

export const crossStyles = {
  standard: { label: 'Standard', symbol: '×' },
  trollface: { label: 'Trollface', image: new URL('./assets/trollface-cross.png', import.meta.url).href },
  frog: { label: 'Frog', image: new URL('./assets/frog-cross.png', import.meta.url).href },
  poop: { label: 'Poop', symbol: '💩' },
} as const;

export function readCrossStyle(): CrossStyle {
  const saved = localStorage.getItem('gridwalkers:cross-style');
  return saved && Object.hasOwn(crossStyles, saved) ? saved as CrossStyle : 'standard';
}

