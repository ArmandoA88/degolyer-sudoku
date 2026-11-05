import assert from 'node:assert/strict';
import test from 'node:test';
import { newGame, editGame, publicGame, earnedCoins } from '../lib/server-game';

test('public snapshots never expose the solution or history, and count active time',()=>{
  const raw=newGame('mini',1000);const visible=publicGame(raw,11000);
  assert.equal(visible.elapsed,10);assert.equal('solution' in visible,false);assert.equal('history' in visible,false);assert.equal('clockAt' in visible,false);assert.equal(raw.elapsed,0);
});
test('givens cannot be changed; mistakes and undo are authoritative',()=>{
  const raw=newGame('mini',1000);const given=raw.puzzle.findIndex(Boolean);assert.throws(()=>editGame(raw,{action:'move',index:given,value:0},true,2000));
  const i=raw.puzzle.findIndex(v=>!v);const wrong=raw.solution[i]%raw.size+1;
  let {game}=editGame(raw,{action:'move',index:i,value:wrong},true,2000);assert.equal(game.mistakes,1);assert.equal(game.board[i],wrong);
  ({game}=editGame(game,{action:'undo'},true,3000));assert.equal(game.board[i],0);assert.equal(game.mistakes,1);
});
test('pause excludes idle time and freeze excludes exactly thirty active seconds',()=>{
  let {game}=editGame(newGame('mini',1000),{action:'pause'},true,11000);assert.equal(game.elapsed,10);
  ({game}=editGame(game,{action:'resume'},true,101000));assert.equal(game.elapsed,10);
  ({game}=editGame(game,{action:'powerup',kind:'freeze'},true,106000));assert.equal(game.elapsed,15);assert.equal(game.powerups.freeze,0);
  assert.equal(publicGame(game,126000).elapsed,15);assert.equal(publicGame(game,146000).elapsed,25);assert.equal(game.usedPowerups,true);
  assert.throws(()=>editGame(game,{action:'powerup',kind:'freeze'},true,147000));
});
test('powerup settings, notes, scan, and unique completion rewards',()=>{
  let game=newGame('mini',1000);const i=game.puzzle.findIndex(v=>!v);
  assert.throws(()=>editGame(game,{action:'powerup',kind:'hint'},false,2000));
  ({game}=editGame(game,{action:'note',index:i,value:1},true,2000));assert.deepEqual(game.notes[i],[1]);
  ({game}=editGame(game,{action:'move',index:i,value:game.solution[i]%4+1},true,3000));
  const scanned=editGame(game,{action:'powerup',kind:'scan'},true,4000);assert.deepEqual(scanned.scan,[i]);game=scanned.game;
  for(let j=0;j<game.board.length;j++)if(game.board[j]!==game.solution[j])({game}=editGame(game,{action:'move',index:j,value:game.solution[j]},true,5000+j*1000));
  assert.equal(game.status,'completed');assert.equal(game.progress,100);assert.equal(earnedCoins(game),20);assert.throws(()=>editGame(game,{action:'move',index:i,value:0},true,99000));
});
