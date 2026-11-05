import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { LEVELS, generatePuzzle, countSolutions } from '../lib/sudoku.ts';

let count = 0;
const began = performance.now();
const results = [];
for (const level of LEVELS) {
  const times = [];
  const blanks = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const p = generatePuzzle(level.id, `benchmark-${i}`);
    times.push(performance.now() - start);
    assert.equal(countSolutions(p.puzzle, p.size, p.boxRows, p.boxCols), 1);
    blanks.push(p.puzzle.filter(n => n === 0).length);
    count++;
  }
  results.push({ level: level.id, puzzles: times.length, meanMs: +(times.reduce((a,b) => a+b) / times.length).toFixed(2), maxMs: +Math.max(...times).toFixed(2), minBlanks: Math.min(...blanks), maxBlanks: Math.max(...blanks) });
}
console.table(results);
console.log(`${count} unique puzzles verified in ${(performance.now() - began).toFixed(1)} ms.`);
