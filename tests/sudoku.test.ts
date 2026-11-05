import assert from "node:assert/strict";
import test from "node:test";
import { LEVELS, candidates, conflicts, countSolutions, generatePuzzle, isComplete } from "../lib/sudoku.ts";

for (const level of LEVELS) {
  test(`${level.id}: solved rows, columns, boxes; unique puzzles across seeds`, () => {
    for (const seed of [1, 27, "DeGolyer ES"]) {
      const game = generatePuzzle(level.id, seed);
      const { size, boxRows, boxCols, solution, puzzle } = game;
      const expected = Array.from({ length: size }, (_, i) => i + 1);
      const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
      for (let r = 0; r < size; r++) assert.deepEqual(sorted(solution.slice(r * size, (r + 1) * size)), expected);
      for (let c = 0; c < size; c++) assert.deepEqual(sorted(Array.from({ length: size }, (_, r) => solution[r * size + c])), expected);
      for (let br = 0; br < size; br += boxRows) for (let bc = 0; bc < size; bc += boxCols) {
        const box: number[] = [];
        for (let r = br; r < br + boxRows; r++) for (let c = bc; c < bc + boxCols; c++) box.push(solution[r * size + c]);
        assert.deepEqual(sorted(box), expected);
      }
      assert.ok(puzzle.some(n => n === 0));
      assert.ok(puzzle.some(n => n !== 0));
      assert.ok(puzzle.filter(n => n === 0).length <= level.blanks);
      puzzle.forEach((n, i) => { if (n) assert.equal(n, solution[i]); });
      const before = [...puzzle];
      assert.equal(countSolutions(puzzle, size, boxRows, boxCols), 1);
      assert.deepEqual(puzzle, before, "solution counting must preserve the puzzle");
      assert.ok(isComplete(solution, solution));
      assert.equal(isComplete(puzzle, solution), false);
    }
  });
}

test("seed controls reproducible puzzles; different seeds vary", () => {
  assert.deepEqual(generatePuzzle("hard", "hello"), generatePuzzle("hard", "hello"));
  assert.notDeepEqual(generatePuzzle("medium", 11).puzzle, generatePuzzle("medium", 12).puzzle);
  assert.throws(() => generatePuzzle("missing"), RangeError);
});

test("candidates and peer conflicts respect rectangular boxes", () => {
  const board = new Array<number>(36).fill(0);
  board[0] = 1; board[1] = 2; board[8] = 3; board[18] = 4;
  assert.deepEqual(candidates(board, 0, 6, 2, 3), [1, 5, 6]);
  board[6] = 1; board[5] = 1; board[7] = 1; board[35] = 1;
  assert.deepEqual(conflicts(board, 0, 6, 2, 3), [5, 6, 7]);
  assert.deepEqual(conflicts(board, 2, 6, 2, 3), []);
});

test("solution counting rejects conflicts and invalid boards; stops at its limit", () => {
  const empty = new Array<number>(16).fill(0);
  assert.equal(countSolutions(empty, 4, 2, 2), 2);
  assert.equal(countSolutions(empty, 4, 2, 2, 1), 1);
  const invalid = [...empty]; invalid[0] = 1; invalid[5] = 1;
  assert.equal(countSolutions(invalid, 4, 2, 2), 0);
  assert.equal(countSolutions([0], 4, 2, 2), 0);
  assert.deepEqual(candidates(empty, -1, 4, 2, 2), []);
  assert.equal(isComplete([], []), false);
  assert.equal(isComplete([0], [0]), false);
});
