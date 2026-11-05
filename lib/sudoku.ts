/** Pure Sudoku rules and unique-puzzle generation. No browser or server state. */
export type SudokuLevel = {
  id: string;
  name: string;
  size: number;
  boxRows: number;
  boxCols: number;
  blanks: number;
  baseCoins: number;
  description: string;
};

export const LEVELS: SudokuLevel[] = [
  { id: "mini", name: "Mini", size: 4, boxRows: 2, boxCols: 2, blanks: 8, baseCoins: 20, description: "A friendly 4 × 4 start. Use numbers 1–4." },
  { id: "easy", name: "Explorer", size: 6, boxRows: 2, boxCols: 3, blanks: 20, baseCoins: 35, description: "Build your skills on a 6 × 6 board. Use 1–6." },
  { id: "medium", name: "Challenger", size: 9, boxRows: 3, boxCols: 3, blanks: 42, baseCoins: 55, description: "Take on classic 9 × 9 Sudoku. Use 1–9." },
  { id: "hard", name: "Expert", size: 9, boxRows: 3, boxCols: 3, blanks: 49, baseCoins: 80, description: "Fewer clues, more careful thinking. Use 1–9." },
  { id: "expert", name: "Master", size: 9, boxRows: 3, boxCols: 3, blanks: 54, baseCoins: 110, description: "Our biggest challenge for confident solvers." },
];

export type SudokuPuzzle = {
  levelId: string;
  size: number;
  boxRows: number;
  boxCols: number;
  puzzle: number[];
  solution: number[];
};

function validShape(board: readonly number[], size: number, boxRows: number, boxCols: number): boolean {
  return Number.isInteger(size) && size > 0 && size <= 16 &&
    Number.isInteger(boxRows) && Number.isInteger(boxCols) && boxRows > 0 && boxCols > 0 &&
    boxRows * boxCols === size && size % boxRows === 0 && size % boxCols === 0 &&
    board.length === size * size && board.every(n => Number.isInteger(n) && n >= 0 && n <= size);
}

function arePeers(a: number, b: number, size: number, boxRows: number, boxCols: number): boolean {
  const ar = Math.floor(a / size), ac = a % size, br = Math.floor(b / size), bc = b % size;
  return ar === br || ac === bc || (Math.floor(ar / boxRows) === Math.floor(br / boxRows) && Math.floor(ac / boxCols) === Math.floor(bc / boxCols));
}

/** Valid digits for a cell, ignoring the cell's current value. */
export function candidates(board: readonly number[], index: number, size: number, boxRows: number, boxCols: number): number[] {
  if (!validShape(board, size, boxRows, boxCols) || !Number.isInteger(index) || index < 0 || index >= board.length) return [];
  const used = new Set<number>();
  for (let i = 0; i < board.length; i++) if (i !== index && board[i] && arePeers(i, index, size, boxRows, boxCols)) used.add(board[i]);
  return Array.from({ length: size }, (_, i) => i + 1).filter(n => !used.has(n));
}

/** Indices of peer cells that duplicate the selected cell's value. */
export function conflicts(board: readonly number[], index: number, size: number, boxRows: number, boxCols: number): number[] {
  if (!validShape(board, size, boxRows, boxCols) || !Number.isInteger(index) || index < 0 || index >= board.length || !board[index]) return [];
  return board.flatMap((value, i) => i !== index && value === board[index] && arePeers(i, index, size, boxRows, boxCols) ? [i] : []);
}

/** Count solutions up to limit. The supplied board is never modified. */
export function countSolutions(board: readonly number[], size: number, boxRows: number, boxCols: number, limit = 2): number {
  if (!validShape(board, size, boxRows, boxCols) || !Number.isInteger(limit) || limit < 1) return 0;
  const full = (1 << size) - 1;
  const rows = new Array<number>(size).fill(0), cols = new Array<number>(size).fill(0), boxes = new Array<number>(size).fill(0);
  const grid = [...board];
  const boxOf = (i: number) => Math.floor(Math.floor(i / size) / boxRows) * (size / boxCols) + Math.floor((i % size) / boxCols);
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i]) continue;
    const bit = 1 << (grid[i] - 1), r = Math.floor(i / size), c = i % size, b = boxOf(i);
    if ((rows[r] | cols[c] | boxes[b]) & bit) return 0;
    rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
  }
  let found = 0;
  function search(): void {
    if (found >= limit) return;
    let selected = -1, selectedMask = 0, fewest = size + 1;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i]) continue;
      const mask = full & ~(rows[Math.floor(i / size)] | cols[i % size] | boxes[boxOf(i)]);
      if (!mask) return;
      let bits = mask, length = 0;
      while (bits) { bits &= bits - 1; length++; }
      if (length < fewest) { selected = i; selectedMask = mask; fewest = length; if (length === 1) break; }
    }
    if (selected === -1) { found++; return; }
    const r = Math.floor(selected / size), c = selected % size, b = boxOf(selected);
    while (selectedMask && found < limit) {
      const bit = selectedMask & -selectedMask;
      selectedMask ^= bit;
      grid[selected] = Math.log2(bit) + 1;
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      search();
      rows[r] ^= bit; cols[c] ^= bit; boxes[b] ^= bit;
      grid[selected] = 0;
    }
  }
  search();
  return found;
}

function seededRandom(seed: string | number): () => number {
  const input = String(seed);
  let state = 2166136261;
  for (let i = 0; i < input.length; i++) state = Math.imul(state ^ input.charCodeAt(i), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle<T>(input: readonly T[], random: () => number): T[] {
  const values = [...input];
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/** Every returned puzzle has exactly one solution. Blanks are a target, bounded by uniqueness. */
export function generatePuzzle(levelId: string, seed?: string | number): SudokuPuzzle {
  const level = LEVELS.find(item => item.id === levelId);
  if (!level) throw new RangeError(`Unknown Sudoku level: ${levelId}`);
  const { size, boxRows, boxCols } = level;
  const random = seededRandom(seed ?? `${Date.now()}-${Math.random()}`);
  const range = (length: number) => Array.from({ length }, (_, i) => i);
  let best: SudokuPuzzle | undefined, bestBlanks = -1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const digits = shuffle(range(size).map(n => n + 1), random);
    const rowOrder = shuffle(range(size / boxRows), random).flatMap(band => shuffle(range(boxRows), random).map(row => band * boxRows + row));
    const colOrder = shuffle(range(size / boxCols), random).flatMap(stack => shuffle(range(boxCols), random).map(col => stack * boxCols + col));
    const solution = rowOrder.flatMap(r => colOrder.map(c => digits[(r * boxCols + Math.floor(r / boxRows) + c) % size]));
    const puzzle = [...solution];
    let blanks = 0;
    for (const index of shuffle(range(size * size), random)) {
      const saved = puzzle[index];
      puzzle[index] = 0;
      if (countSolutions(puzzle, size, boxRows, boxCols) === 1) blanks++;
      else puzzle[index] = saved;
      if (blanks >= level.blanks) break;
    }
    if (blanks > bestBlanks) {
      bestBlanks = blanks;
      best = { levelId, size, boxRows, boxCols, puzzle, solution };
    }
    if (blanks >= level.blanks) break;
  }
  return best!;
}

export function isComplete(board: readonly number[], solution: readonly number[]): boolean {
  return board.length > 0 && board.length === solution.length && board.every((n, i) => Number.isInteger(n) && n > 0 && n === solution[i]);
}
