import type { Board, Line, Mark, Patch } from './protocol.ts';
import { analyze } from './puzzle.ts';
import type { Puzzle } from './puzzle.ts';

export type Game = { id: string; puzzle: Puzzle; marks: Mark[]; view: Board };
function indices(size: number, start: number, step: number) {
  return Array.from({ length: size }, (_, i) => start + i * step);
}
function complete(game: Game, line: number[]) {
  return line.every(i => Number(game.marks[i] === 1) === game.puzzle.solution[i]);
}
function partial(view: Board, line: number[], clues: number[], done: boolean): Line {
  if (done) return { complete: true, grey: clues.map(() => true) };
  const marks = line.map(i => view.cells[i] === 2 ? 0 : view.cells[i] === 1 ? 1 : -1);
  const result = analyze(marks, clues, true);
  return {
    complete: false,
    grey: clues.map((length, i) => {
      const positions = result?.placements[i];
      if (!positions || positions.size !== 1) return false;
      const [start] = positions;
      const end = start + length;
      return (start === 0 || marks[start - 1] === 0) && (end === marks.length || marks[end] === 0)
        && marks.slice(start, end).every(mark => mark === 1);
    }),
  };
}
function shown(game: Game, i: number, w: number): Mark {
  return game.marks[i] || (game.view.rowState[Math.floor(i / w)].complete || game.view.columnState[i % w].complete ? 2 : 0);
}
export function newGame(id: string, puzzle: Puzzle): Game {
  const w = puzzle.columns.length;
  const h = puzzle.rows.length;
  const marks = Array<Mark>(w * h).fill(0);
  const game: Game = { id, puzzle, marks, view: { id, rows: puzzle.rows, columns: puzzle.columns, cells: [...marks], rowState: [], columnState: [] } };
  game.view.rowState = puzzle.rows.map((clues, y) => ({ complete: complete(game, indices(w, y * w, 1)), grey: clues.map(() => false) }));
  game.view.columnState = puzzle.columns.map((clues, x) => ({ complete: complete(game, indices(h, x, w)), grey: clues.map(() => false) }));
  game.view.cells = marks.map((_, i) => shown(game, i, w));
  game.view.rowState = puzzle.rows.map((clues, y) => partial(game.view, indices(w, y * w, 1), clues, game.view.rowState[y].complete));
  game.view.columnState = puzzle.columns.map((clues, x) => partial(game.view, indices(h, x, w), clues, game.view.columnState[x].complete));
  return game;
}

export function markCell(game: Game, x: number, y: number, mark: Mark): Pick<Patch, 'cells' | 'rows' | 'columns'> | undefined {
  const { view, marks } = game;
  const w = view.columns.length;
  const h = view.rows.length;
  const index = y * w + x;
  if (marks[index] === mark || (mark === 2 && marks[index] === 0 && view.cells[index] === 2)) return;
  marks[index] = mark;
  const cells = new Set([index]);
  const row = indices(w, y * w, 1);
  const column = indices(h, x, w);
  const rowDone = complete(game, row);
  const columnDone = complete(game, column);
  if (rowDone !== view.rowState[y].complete) row.forEach(i => cells.add(i));
  if (columnDone !== view.columnState[x].complete) column.forEach(i => cells.add(i));
  const oldRow = view.rowState[y];
  const oldColumn = view.columnState[x];
  view.rowState[y] = { ...oldRow, complete: rowDone };
  view.columnState[x] = { ...oldColumn, complete: columnDone };
  const patch: Pick<Patch, 'cells' | 'rows' | 'columns'> = { cells: [], rows: [], columns: [] };
  const rows = new Set([y]);
  const columns = new Set([x]);
  for (const i of cells) {
    const next = shown(game, i, w);
    if (next === view.cells[i]) continue;
    view.cells[i] = next;
    patch.cells.push([i, next]);
    rows.add(Math.floor(i / w));
    columns.add(i % w);
  }
  for (const r of rows) {
    const previous = r === y ? oldRow : view.rowState[r];
    const state = partial(view, indices(w, r * w, 1), view.rows[r], view.rowState[r].complete);
    view.rowState[r] = state;
    if (JSON.stringify(previous) !== JSON.stringify(state)) patch.rows.push([r, state]);
  }
  for (const c of columns) {
    const previous = c === x ? oldColumn : view.columnState[c];
    const state = partial(view, indices(h, c, w), view.columns[c], view.columnState[c].complete);
    view.columnState[c] = state;
    if (JSON.stringify(previous) !== JSON.stringify(state)) patch.columns.push([c, state]);
  }
  return patch;
}
