import { Budget, classify, describe, solve } from './puzzle.ts';
import type { Puzzle } from './puzzle.ts';
import type { SettingsInput } from './protocol.ts';

export const maxImageGrid = 30;
const reference: [id: string, rows: string[], starter?: number][] = [
  ['A', ["0000101","0111000","1101000","0111110","0011111","0001110","0011000"], 4],
  ['B', ["00010100","00101010","00101010","01111111","01111000","10111111","11000000","01100101"]],
  ['C', ["000011100000","000011110000","000010011000","000001111000","000000011100","000111011100","001111101110","111111111110","111111111111","110111101110","111000011100","001111110000"]],
  ['D', ["00000000000000","00100011000000","01010010100000","01001010100000","00101010100110","00011111001111","00010101001111","01111111100110","11100011110000","11110111110100","11111111110100","01110111101110","00000000011110","00110110111100"]],
  ['E', ["000011110000","000100001110","000100001001","000111111001","010111111110","110011110001","111000000111","011111111110","000111111000"]],
  ['F', ["00000010000000","00000101000000","00000010100000","00111010111100","01111111111110","01111111111110","11110011100111","11100111110011","11111111111111","11110111100111","11110010000111","01111000101110","01111111111110","00111011110100"]],
  ['G', ["00000100000","00001110000","00011111000","00101010100","00110001100","00110001100","00110001011","11010100111","11100001110","01110011100","00111011000","00011000000"]],
  ['H', ["000111000000","001111100000","001111101110","000011101111","011100101111","111111011111","111110100110","011100111000","000001111100","000101111100","001100111000","001000000000"], 111],
  ['I', ["00000000000000","00001111110000","00111000011100","01111000011110","11011100111011","10011111111001","10011111111001","11111100111111","01111000011110","00111100111100","00001111110000","00000000000000","00001111110000","00000111100000"]],
  ['J', ["000000010000000","000000111000000","011010111010110","011011010110110","001001000100100","000100000001000","010110010011010","110110111011011","111001111100111","000110010011000","001110000011100","001100111001100","000000111000000","000000010000000"]],
  ['K', ["1001000010","1001000010","1111000010","0110000010","0110000000","0110000111","0110000101","1001000101","0110000111"]],
  ['L', ["000111100000","001111110000","011011110000","110001101100","100011011110","100110111111","100101101111","100011000110","110000001100","011000011000","001111110000","000111100000"]],
  ['M', ["000011111000","001111111110","011111111111","011111111111","111111111111","110110111111","100110011111","111111111110","010101111100","011111110000","111111100000","101010100000"]],
  ['N', ["111101101100111","111000101001011","110010100011011","101000001110011","011001111000101","010011000000110","000110011110010","101100000011001","101001001001101","110001011000011","111100000001111","011111111111110","000111111111000"]],
  ['O', ["11100000000","00111111111","00101010101","00011111110","00010101010","00001111100","00010000010"]],
];

export const picturePack = reference.map(([id, rows, starter]) => {
  const width = rows[0].length;
  const height = rows.length;
  const puzzle = describe(rows.join('').split('').map(Number), width, height);
  if (starter !== undefined) puzzle.starters = [starter];
  const seed = puzzle.solution.map((value, index) => index === starter ? value : -1);
  const difficulty = classify(solve(puzzle, new Budget(Infinity, Infinity), seed)!.metrics);
  return { id, width, height, difficulty, puzzle };
});

export function getPicture(id?: string) {
  return picturePack.find(picture => picture.id === id);
}

export function validImageCells(width: number, height: number, cells?: string): cells is string {
  return Number.isInteger(width) && Number.isInteger(height) && width >= 5 && height >= 5 &&
    width <= maxImageGrid && height <= maxImageGrid && typeof cells === 'string' &&
    cells.length === width * height && /^[01]+$/.test(cells) && cells.includes('0') && cells.includes('1');
}

export function picturePuzzle(settings: SettingsInput): Puzzle | undefined {
  if (!settings.picture) return;
  if (settings.picture !== 'upload') {
    const picture = getPicture(settings.picture);
    if (!picture) throw new Error('Choose a picture from the pack.');
    return picture.puzzle;
  }
  const { width, height, imageCells } = settings;
  if (!validImageCells(width, height, imageCells)) throw new Error('Choose an image with both filled and empty cells.');
  const solution = imageCells.split('').map(Number);
  const puzzle = describe(solution, width, height);
  const budget = new Budget(120_000_000, Date.now() + 4200);
  const seed = solution.map(() => -1);
  const starters: number[] = [];
  let unseededFills = solution.reduce((total, value) => total + value, 0);
  while (true) {
    const result = solve(puzzle, budget, seed)!;
    const unknown = result.cells.flatMap((value, index) => value === -1 && (unseededFills > 1 || solution[index] === 0) ? [index] : []);
    if (!unknown.length) break;
    // Start with a few known cells when the clues alone leave ambiguous placements.
    const count = Math.max(1, Math.floor(unknown.length / 20));
    for (let i = 0; i < count; i++) {
      const index = unknown[Math.floor(i * unknown.length / count)];
      if (solution[index] === 1 && unseededFills === 1) continue;
      seed[index] = solution[index];
      starters.push(index);
      unseededFills -= solution[index];
    }
  }
  puzzle.starters = starters;
  return puzzle;
}
