export function clues(line: readonly number[]): number[] {
  const runs: number[] = [];
  let length = 0;
  for (const cell of line) {
    if (cell === 1) {
      length++;
    } else if (length) {
      runs.push(length);
      length = 0;
    }
  }
  if (length) runs.push(length);
  return runs.length ? runs : [0];
}
