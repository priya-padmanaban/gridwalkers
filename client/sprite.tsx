import { accessories, hairColors, shirts, skins } from '../shared/protocol.ts';
import type { Direction, Profile } from '../shared/protocol.ts';
import { useEffect, useRef } from 'react';

export function sprite(ctx: CanvasRenderingContext2D, profile: Profile, direction: Direction, x: number, y: number, size: number, step = 0, fill = false) {
  const p = size / 16;
  const rect = (a: number, b: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x + a * p), Math.round(y + b * p), Math.ceil(w * p), Math.ceil(h * p));
  };
  const dark = '#38312e';
  const skin = skins[profile.skin];
  const hair = hairColors[profile.hair];
  const shirt = shirts[profile.shirt];
  const bob = Math.abs(step);
  rect(2, 15, 12, 1, '#34312944');
  rect(4, 13 + step, 3, 2, dark);
  rect(9, 13 - step, 3, 2, dark);
  rect(3, 9 - bob, 10, 5, dark);
  rect(4, 9 - bob, 8, 4, shirt);
  rect(3, 10 - bob, 2, 2, skin);
  rect(11, 10 - bob, 2, 2, skin);
  rect(3, 2 - bob, 10, 8, dark);
  rect(4, 3 - bob, 8, 6, direction === 'up' ? hair : skin);
  rect(4, 2 - bob, 8, 3, hair);
  if (profile.style === 1) rect(4, 4 - bob, 4, 2, hair);
  if (profile.style === 2) { rect(2, 2 - bob, 3, 4, hair); rect(11, 2 - bob, 3, 4, hair); }
  if (direction !== 'up') {
    if (direction !== 'right') rect(5, 6 - bob, 1, 1, dark);
    if (direction !== 'left') rect(10, 6 - bob, 1, 1, dark);
    rect(7, 8 - bob, 2, 1, '#b26450');
  }
  if (accessories[profile.accessory] === 'Cap') {
    rect(4, 0, 8, 2, '#b1544c');
    rect(3, 2, 11, 1, '#db7763');
  }
  if (accessories[profile.accessory] === 'Bow') {
    rect(9, 1, 2, 2, '#ed9f76');
    rect(12, 1, 2, 2, '#ed9f76');
    rect(11, 2, 1, 1, '#bd654a');
  }
  if (fill) {
    rect(13, 8, 1, 5, '#8b5840');
    rect(12, 7, 3, 2, '#ffbd58');
  }
}

export function Avatar({ profile, size = 36 }: { profile: Profile; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    sprite(ctx, profile, 'down', 0, 0, size);
  }, [profile, size]);
  return <canvas ref={ref} width={size} height={size} className="avatar" aria-hidden="true" />;
}
