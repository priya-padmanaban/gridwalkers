import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { boardMargin, directions, insideBoard, movementInterval } from '../shared/protocol.ts';
import type { Direction, Line, Mark, Point, Snapshot } from '../shared/protocol.ts';
import { sprite } from './sprite.tsx';

export type CameraAction = 'fit' | 'center' | 'in' | 'out';
export type BoardControls = { camera(action: CameraAction): void; focus(): void };
type Props = {
  room: Snapshot; id: string; controls: RefObject<BoardControls | null>; reduced: boolean;
  change(x: number, y: number, mark: Mark): void; cross(points: Point[]): void; move(direction: Direction): void; toggle(): void;
  enabled: boolean; dark: boolean; onZoom(zoom: number): void; optimistic: MutableRefObject<Map<number, Mark>>;
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
    let pan: Point | undefined;
    let stroke: { last: Point; cells: Map<number, Point> } | undefined;
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
      const { room, id } = latest.current;
      const margin = (!room.players.find(player => player.id === id)?.gridOnly ||
        room.players.some(player => player.connected && !insideBoard(player.position, room.settings))) ? boardMargin * camera.tile : 0;
      const bound = (p: number, available: number, size: number) => size + 2 * margin < available
        ? (available - size) / 2 : clamp(p, available - size - margin, margin);
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
      const { room, id } = latest.current;
      const held = [...new Set(pressed.values())];
      let direction = queuedDirection ?? held.at(-1);
      if (!room.players.find(player => player.id === id)?.gridOnly && held.length > 1) {
        const x = Number(held.includes('right')) - Number(held.includes('left'));
        const y = Number(held.includes('down')) - Number(held.includes('up'));
        direction = (Object.keys(directions) as Direction[]).find(key => directions[key].x === x && directions[key].y === y);
      }
      if (!direction) return;
      queuedDirection = undefined;
      latest.current.move(direction);
      const delta = directions[direction];
      nextMove = (now - nextMove < 16 ? nextMove : now) + movementInterval * Math.hypot(delta.x, delta.y);
    }

    function glide(room: Snapshot, now: number, reduced: boolean) {
      const distance = Math.min(50, Math.max(0, now - previousFrame)) / movementInterval;
      previousFrame = now;
      for (const { id, position: target, gridOnly } of room.players) {
        const current = motion.get(id)?.position ?? target;
        if (reduced || (gridOnly && !insideBoard(current, room.settings) && !insideBoard({ x: Math.round(current.x), y: Math.round(current.y) }, room.settings))) {
          motion.set(id, { position: target, moving: false });
          continue;
        }
        const dx = target.x - current.x;
        const dy = target.y - current.y;
        const remaining = Math.hypot(dx, dy);
        const fraction = remaining ? Math.min(1, distance / remaining) : 0;
        const x = current.x + dx * fraction;
        const y = current.y + dy * fraction;
        motion.set(id, { position: { x, y }, moving: x !== current.x || y !== current.y });
      }
    }

    function lineText(values: number[], status: Line, x: number, y: number, horizontal: boolean, available: number) {
      const dark = latest.current.dark;
      const slot = Math.min(scale(), available / values.length);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 ' + Math.max(8, Math.min(camera.tile * 0.61, slot * 0.82, 15)) + 'px "IBM Plex Mono", monospace';
      for (let i = 0; i < values.length; i++) {
        ctx.fillStyle = status.grey[i] ? (dark ? '#8f9b94' : '#819180') : (dark ? '#e1ebe4' : '#2b4738');
        const offset = (values.length - i - 0.5) * slot;
        ctx.fillText(String(values[i]), horizontal ? x - offset : x, horizontal ? y : y - offset, slot);
      }
    }
    function render(now: number) {
      frame = requestAnimationFrame(render);
      const { room, reduced, enabled, dark, id, optimistic } = latest.current;
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
      ctx.fillStyle = dark ? '#19221e' : '#edf0e4';
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
        const actual = optimistic.current.get(i) ?? board.cells[i];
        const mark = actual === 0 && stroke && stroke.cells.size > 1 && stroke.cells.has(i) ? 2 : actual;
        const px = ox + x * t;
        const py = oy + y * t;
        const focused = x === me?.position.x || y === me?.position.y;
        ctx.fillStyle = mark === 1 ? (dark ? '#6b9b7c' : '#416852') : focused ? (dark ? '#283a30' : '#f1f4e9') : (dark ? '#222e28' : '#fffdf5');
        ctx.fillRect(px, py, t, t);
        if (mark === 1 && t >= 15) {
          ctx.fillStyle = '#ffffff1f';
          ctx.fillRect(px + 2, py + 2, t - 4, 2);
        }
        if (mark === 2) {
          ctx.strokeStyle = dark ? '#9aab9f' : '#789080';
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
        ctx.strokeStyle = strong ? (dark ? '#83998a' : '#5e7666') : (dark ? '#46574c' : '#b9c8b8');
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
          const facing = directions[player.direction].x < 0 ? 'left' : directions[player.direction].x > 0 ? 'right' : player.direction;
          sprite(ctx, player.profile, facing, px + (t - size) / 2, py + t - size - t * 0.13, size,
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
        ctx.fillStyle = x === me?.position.x ? (dark ? '#385346' : '#d3e2cd')
          : board.columnState[x].complete ? (dark ? '#293a31' : '#e3ecdf') : (dark ? '#252f29' : '#f6f7ed');
        ctx.fillRect(ox + x * t, 0, t - 1, top - 1);
        lineText(board.columns[x], board.columnState[x], ox + (x + 0.5) * t, top - 6, false, top - 10);
      }
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.rect(0, top, left, height - top); ctx.clip();
      for (let y = y0; y < y1; y++) {
        ctx.fillStyle = y === me?.position.y ? (dark ? '#385346' : '#d3e2cd')
          : board.rowState[y].complete ? (dark ? '#293a31' : '#e3ecdf') : (dark ? '#252f29' : '#f6f7ed');
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
      if (event.button === 1) pan = { x: event.clientX, y: event.clientY };
      else {
        const cell = point(event);
        if (cell && latest.current.enabled) {
          stroke = { last: cell, cells: new Map([[cell.y * latest.current.room.settings.width + cell.x, cell]]) };
        }
      }
    }
    function move(event: PointerEvent) {
      hover = point(event);
      if (pan) {
        camera.x += event.clientX - pan.x;
        camera.y += event.clientY - pan.y;
        camera.follow = false;
        pan = { x: event.clientX, y: event.clientY };
      }
      if (hover) paintTo(hover);
    }
    function paintTo(cell: Point) {
      if (!stroke) return;
      const { x, y } = stroke.last;
      const steps = Math.max(Math.abs(cell.x - x), Math.abs(cell.y - y));
      const w = latest.current.room.settings.width;
      for (let i = 1; i <= steps; i++) {
        const px = Math.round(x + (cell.x - x) * i / steps);
        const py = Math.round(y + (cell.y - y) * i / steps);
        stroke.cells.set(py * w + px, { x: px, y: py });
      }
      stroke.last = cell;
    }
    function up(event: PointerEvent) {
      if (event.button === 1) pan = undefined;
      if (event.button !== 0 || !stroke) return;
      const cell = point(event);
      if (cell) paintTo(cell);
      const cells = stroke.cells;
      stroke = undefined;
      const { enabled, room, optimistic, change, cross } = latest.current;
      if (!enabled) return;
      if (cells.size > 1) { cross([...cells.values()]); return; }
      if (!cell) return;
      const index = cell.y * room.settings.width + cell.x;
      const mark = optimistic.current.get(index) ?? room.board?.cells[index];
      change(cell.x, cell.y, mark === 2 ? 0 : 2);
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
    const cancel = () => { pan = undefined; stroke = undefined; hover = undefined; };
    const leave = () => { hover = undefined; };
    const menu = (event: MouseEvent) => event.preventDefault();
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
