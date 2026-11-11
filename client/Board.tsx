import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { directions, movementInterval } from '../shared/protocol.ts';
import type { Direction, Line, Mark, Point, Snapshot } from '../shared/protocol.ts';
import { sprite } from './sprite.tsx';

export type CameraAction = 'fit' | 'center' | 'in' | 'out';
export type BoardControls = { camera(action: CameraAction): void; focus(): void };
type Props = {
  room: Snapshot; id: string; controls: RefObject<BoardControls | null>; reduced: boolean;
  change(x: number, y: number, mark: Mark): void; move(direction: Direction): void; toggle(): void;
  enabled: boolean; onZoom(zoom: number): void; optimistic: MutableRefObject<Map<number, Mark>>;
};
const keys: Record<string, Direction> = { w: 'up', a: 'left', s: 'down', d: 'right', arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right' };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function BoardCanvas(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext('2d')!;
    const camera = { tile: 30, x: 0, y: 0, follow: true };
    let width = 0;
    let height = 0;
    let left = 0;
    let top = 0;
    let rowSlots = 1;
    let columnSlots = 1;
    let frame = 0;
    let boardId = '';
    let hover: Point | undefined;
    let drag: { x: number; y: number; pan: boolean; button: number } | undefined;
    const pressed = new Map<string, Direction>();
    const motion = new Map<string, { position: Point; moving: boolean }>();
    const flashes = new Map<number, number>();
    let previousCells: Mark[] | undefined;
    let nextMove = -Infinity;
    let previousFrame = 0;
    let queuedDirection: Direction | undefined;
    const scale = () => clamp(camera.tile * 0.56, 10, 19);

    function layout() {
      left = Math.min(width * 0.42, rowSlots * scale() + 15);
      top = Math.min(height * 0.42, columnSlots * scale() + 15);
    }
    function constrain(w: number, h: number) {
      const bound = (p: number, available: number, size: number) => size < available
        ? (available - size) / 2 : clamp(p, available - size, 0);
      camera.x = bound(camera.x, width - left, w * camera.tile);
      camera.y = bound(camera.y, height - top, h * camera.tile);
    }
    function center(w: number, h: number) {
      const { room, id } = latest.current;
      const position = motion.get(id)?.position ?? room.players.find(p => p.id === id)?.position;
      if (position) {
        camera.x = (width - left) / 2 - (position.x + 0.5) * camera.tile;
        camera.y = (height - top) / 2 - (position.y + 0.5) * camera.tile;
      }
      constrain(w, h);
    }
    function action(value: CameraAction) {
      const { width: w, height: h } = latest.current.room.settings;
      if (value === 'center') {
        camera.follow = true;
        center(w, h);
      } else if (value === 'fit') {
        camera.follow = false;
        camera.tile = 5;
        for (let size = 6; size <= 54; size++) {
          camera.tile = size;
          layout();
          if (w * size > width - left || h * size > height - top) { camera.tile = size - 1; break; }
        }
        layout();
        constrain(w, h);
      } else {
        const old = camera.tile;
        const pivotX = (width - left) / 2;
        const pivotY = (height - top) / 2;
        camera.tile = clamp(camera.tile + (value === 'in' ? 4 : -4), 5, 58);
        layout();
        camera.x = (width - left) / 2 - (pivotX - camera.x) * camera.tile / old;
        camera.y = (height - top) / 2 - (pivotY - camera.y) * camera.tile / old;
        constrain(w, h);
      }
      latest.current.onZoom(Math.round(camera.tile / 30 * 100));
    }
    props.controls.current = { camera: action, focus: () => element.focus() };

    function step(now: number) {
      if (!latest.current.enabled || now < nextMove) return;
      const direction = queuedDirection ?? Array.from(pressed.values()).at(-1);
      if (!direction) return;
      queuedDirection = undefined;
      latest.current.move(direction);
      nextMove = (now - nextMove < 16 ? nextMove : now) + movementInterval;
    }

    function glide(room: Snapshot, now: number, reduced: boolean) {
      const distance = Math.min(50, Math.max(0, now - previousFrame)) / movementInterval;
      previousFrame = now;
      for (const { id, position: target, direction } of room.players) {
        const current = motion.get(id)?.position ?? target;
        if (reduced) { motion.set(id, { position: target, moving: false }); continue; }
        const dx = target.x - current.x;
        const dy = target.y - current.y;
        // Finish the previous axis first when a turn arrives before a tile is reached.
        const verticalFirst = directions[direction].x !== 0;
        const first = Math.min(distance, Math.abs(verticalFirst ? dy : dx));
        const second = distance - first;
        const x = current.x + Math.sign(dx) * Math.min(Math.abs(dx), verticalFirst ? second : first);
        const y = current.y + Math.sign(dy) * Math.min(Math.abs(dy), verticalFirst ? first : second);
        motion.set(id, { position: { x, y }, moving: x !== current.x || y !== current.y });
      }
    }

    function lineText(values: number[], status: Line, x: number, y: number, horizontal: boolean, available: number) {
      const slot = Math.min(scale(), available / values.length);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 ' + Math.max(8, Math.min(camera.tile * 0.61, slot * 0.82, 15)) + 'px "IBM Plex Mono", monospace';
      for (let i = 0; i < values.length; i++) {
        ctx.fillStyle = status.grey[i] ? '#819180' : '#2b4738';
        const offset = (values.length - i - 0.5) * slot;
        ctx.fillText(String(values[i]), horizontal ? x - offset : x, horizontal ? y : y - offset, slot);
      }
    }
    function render(now: number) {
      frame = requestAnimationFrame(render);
      const { room, reduced, enabled, id, optimistic } = latest.current;
      if (!room.board) return;
      const board = room.board;
      const { width: w, height: h } = room.settings;
      const dpr = window.devicePixelRatio || 1;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      if (width !== bounds.width || height !== bounds.height || element.width !== Math.round(width * dpr)) {
        width = bounds.width;
        height = bounds.height;
        element.width = Math.round(width * dpr);
        element.height = Math.round(height * dpr);
      }
      if (boardId !== board.id) {
        boardId = board.id;
        rowSlots = Math.max(...board.rows.map(line => line.length));
        columnSlots = Math.max(...board.columns.map(line => line.length));
        motion.clear();
        flashes.clear();
        previousCells = undefined;
        camera.tile = Math.max(w, h) > 22 ? 28 : 34;
        camera.follow = true;
        latest.current.onZoom(Math.round(camera.tile / 30 * 100));
      }
      layout();
      glide(room, now, reduced);
      if (camera.follow) center(w, h);
      else constrain(w, h);
      if (enabled) step(now);
      if (previousCells && previousCells !== board.cells && !reduced) {
        for (let i = 0; i < board.cells.length; i++) {
          if (board.cells[i] === 1 && previousCells[i] !== 1) flashes.set(i, now);
        }
      }
      previousCells = board.cells;
      for (const [i, at] of flashes) if (now - at > 350) flashes.delete(i);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#edf0e4';
      ctx.fillRect(0, 0, width, height);
      const t = camera.tile;
      const ox = left + camera.x;
      const oy = top + camera.y;
      const x0 = clamp(Math.floor(-camera.x / t), 0, w);
      const y0 = clamp(Math.floor(-camera.y / t), 0, h);
      const x1 = clamp(Math.ceil((width - ox) / t), 0, w);
      const y1 = clamp(Math.ceil((height - oy) / t), 0, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width - left, height - top);
      ctx.clip();
      const me = room.players.find(player => player.id === id);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const mark = optimistic.current.get(i) ?? board.cells[i];
        const px = ox + x * t;
        const py = oy + y * t;
        ctx.fillStyle = mark === 1 ? '#416852' : (x === me?.position.x || y === me?.position.y) ? '#f1f4e9' : '#fffdf5';
        ctx.fillRect(px, py, t, t);
        if (mark === 1 && t >= 15) {
          ctx.fillStyle = '#ffffff1f';
          ctx.fillRect(px + 2, py + 2, t - 4, 2);
        }
        if (mark === 2) {
          ctx.strokeStyle = '#789080';
          ctx.lineWidth = Math.max(1, t / 19);
          ctx.beginPath();
          ctx.moveTo(px + t * 0.35, py + t * 0.35);
          ctx.lineTo(px + t * 0.65, py + t * 0.65);
          ctx.moveTo(px + t * 0.65, py + t * 0.35);
          ctx.lineTo(px + t * 0.35, py + t * 0.65);
          ctx.stroke();
        }
        if (hover?.x === x && hover.y === y) {
          ctx.fillStyle = '#d7a44e44';
          ctx.fillRect(px, py, t, t);
        }
        const flash = flashes.get(i);
        if (flash !== undefined) {
          ctx.fillStyle = 'rgba(255,215,133,' + (1 - (now - flash) / 350) * 0.66 + ')';
          ctx.fillRect(px, py, t, t);
        }
      }
      function gridLine(index: number, max: number, vertical: boolean) {
        const strong = index % 5 === 0 || index === max;
        ctx.strokeStyle = strong ? '#5e7666' : '#b9c8b8';
        ctx.lineWidth = strong ? 1.8 : 0.8;
        ctx.beginPath();
        if (vertical) { ctx.moveTo(ox + index * t, oy); ctx.lineTo(ox + index * t, oy + h * t); }
        else { ctx.moveTo(ox, oy + index * t); ctx.lineTo(ox + w * t, oy + index * t); }
        ctx.stroke();
      }
      for (let x = x0; x <= x1; x++) gridLine(x, w, true);
      for (let y = y0; y <= y1; y++) gridLine(y, h, false);
      if (room.phase === 'playing' || room.phase === 'failed') {
        for (const player of room.players.filter(player => player.connected).sort((a, b) => Number(a.id === id) - Number(b.id === id))) {
          const track = motion.get(player.id)!;
          const px = ox + track.position.x * t;
          const py = oy + track.position.y * t;
          const size = Math.max(9, t * 0.89);
          sprite(ctx, player.profile, player.direction, px + (t - size) / 2, py + t - size - t * 0.13, size,
            track.moving ? (Math.floor(now / 75) % 2 ? 1 : -1) : 0, player.mode === 'fill');
          ctx.fillStyle = player.color;
          ctx.fillRect(px + t * 0.22, py + t - 3, t * 0.56, 2);
          if (t >= 27) {
            ctx.font = '600 10px "DM Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const label = ctx.measureText(player.profile.name).width;
            ctx.fillStyle = '#244333';
            ctx.fillRect(px + t / 2 - label / 2 - 4, py - 15, label + 8, 13);
            ctx.fillStyle = '#fffdf4';
            ctx.fillText(player.profile.name, px + t / 2, py - 2);
          }
        }
      }
      ctx.restore();

      ctx.save();
      ctx.beginPath(); ctx.rect(left, 0, width - left, top); ctx.clip();
      for (let x = x0; x < x1; x++) {
        ctx.fillStyle = x === me?.position.x ? '#d3e2cd' : board.columnState[x].complete ? '#e3ecdf' : '#f6f7ed';
        ctx.fillRect(ox + x * t, 0, t - 1, top - 1);
        lineText(board.columns[x], board.columnState[x], ox + (x + 0.5) * t, top - 6, false, top - 10);
      }
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.rect(0, top, left, height - top); ctx.clip();
      for (let y = y0; y < y1; y++) {
        ctx.fillStyle = y === me?.position.y ? '#d3e2cd' : board.rowState[y].complete ? '#e3ecdf' : '#f6f7ed';
        ctx.fillRect(0, oy + y * t, left - 1, t - 1);
        lineText(board.rows[y], board.rowState[y], left - 6, oy + (y + 0.5) * t, true, left - 10);
      }
      ctx.restore();
    }

    function point(event: MouseEvent): Point | undefined {
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      if (px < left || py < top) return;
      const x = Math.floor((px - left - camera.x) / camera.tile);
      const y = Math.floor((py - top - camera.y) / camera.tile);
      if (x >= 0 && y >= 0 && x < latest.current.room.settings.width && y < latest.current.room.settings.height) return { x, y };
    }
    function down(event: PointerEvent) {
      if (event.button !== 0 && event.button !== 1) return;
      if (event.button === 1) event.preventDefault();
      element.focus({ preventScroll: true });
      element.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, pan: event.button === 1, button: event.button };
    }
    function move(event: PointerEvent) {
      hover = point(event);
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (drag.pan || Math.hypot(dx, dy) > 5) {
        camera.x += dx;
        camera.y += dy;
        camera.follow = false;
        drag = { ...drag, x: event.clientX, y: event.clientY, pan: true };
      }
    }
    function markAt(event: MouseEvent, cross: boolean) {
      const cell = point(event);
      if (!cell || !latest.current.enabled) return;
      const { room, optimistic } = latest.current;
      const index = cell.y * room.settings.width + cell.x;
      const mark = optimistic.current.get(index) ?? room.board?.cells[index];
      const requested = cross ? 2 : 1;
      latest.current.change(cell.x, cell.y, mark === requested ? 0 : requested);
    }
    function up(event: PointerEvent) {
      if (drag && !drag.pan && drag.button === 0 && event.button === 0) markAt(event, false);
      drag = undefined;
    }
    function keydown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || !latest.current.enabled) return;
      const key = event.key.toLowerCase();
      const direction = keys[key];
      if (direction && Object.hasOwn(directions, direction)) {
        event.preventDefault();
        if (!event.repeat && !pressed.has(key)) {
          pressed.set(key, direction);
          queuedDirection = direction;
          step(performance.now());
        }
      }
      if (key === 'q' && !event.repeat) { event.preventDefault(); latest.current.toggle(); }
    }
    const keyup = (event: KeyboardEvent) => { pressed.delete(event.key.toLowerCase()); };
    const blur = () => { pressed.clear(); queuedDirection = undefined; };
    const cancel = () => { drag = undefined; hover = undefined; };
    const leave = () => { hover = undefined; };
    const menu = (event: MouseEvent) => {
      event.preventDefault();
      if (event.button !== 2) return;
      element.focus({ preventScroll: true });
      markAt(event, true);
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('contextmenu', menu);
    element.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    element.addEventListener('blur', blur);
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('contextmenu', menu);
      element.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      element.removeEventListener('blur', blur);
      props.controls.current = null;
    };
  }, []);
  return <canvas className="board-canvas" tabIndex={0} ref={canvas} aria-label="Nonogram board. Use W A S D or arrows to move and Q to toggle Fill mode." />;
}
