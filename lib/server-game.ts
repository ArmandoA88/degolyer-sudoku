import { generatePuzzle, completionCoins, isComplete } from './sudoku';
import type { Game } from './types';
export type StoredGame = Game & {solution:number[];history:{board:number[];notes:number[][]}[];clockAt:number;freezeUntil:number;elapsedMs:number};
export function newGame(levelId:string,now=Date.now()):StoredGame {
  const p=generatePuzzle(levelId);
  return {...p,id:crypto.randomUUID(),board:[...p.puzzle],notes:p.puzzle.map(()=>[]),elapsed:0,elapsedMs:0,mistakes:0,hints:0,scans:0,freezes:0,status:'playing',startedAt:now,updatedAt:now,clockAt:now,freezeUntil:0,progress:0,powerups:{hint:3,scan:2,freeze:1},usedPowerups:false,revision:0,history:[]};
}
export function advanceClock(game:StoredGame,now=Date.now()) {
  if(game.status==='playing') game.elapsedMs+=Math.max(0,now-Math.max(game.clockAt,game.freezeUntil));
  game.clockAt=now;game.elapsed=Math.floor(game.elapsedMs/1000);return game;
}
export function publicGame(raw:StoredGame,now=Date.now()):Game {
  const g=advanceClock(structuredClone(raw),now);
  const {solution,history,clockAt,freezeUntil,elapsedMs,...safe}=g;
  return {...safe,freezeRemaining:Math.max(0,Math.ceil((g.freezeUntil-now)/1000))};
}
export function editGame(raw:StoredGame,input:Record<string,unknown>,powerupsAllowed:boolean,now=Date.now()) {
  const g=advanceClock(structuredClone(raw),now);const action=String(input.action);let scan:number[]|undefined;
  if(g.status==='completed') throw new Error('This puzzle is complete. Start a new puzzle.');
  if(action==='pause'){g.status='paused';}
  else if(action==='resume'){g.status='playing';}
  else if(action==='heartbeat'){}
  else {
    if(g.status!=='playing')throw new Error('Resume your puzzle first.');
    const index=Number(input.index),value=Number(input.value);
    if(action==='move'||action==='note'){
      if(!Number.isInteger(index)||index<0||index>=g.board.length||g.puzzle[index])throw new Error('Choose an editable cell.');
      if(!Number.isInteger(value)||value<0||value>g.size)throw new Error('Choose a number on this board.');
      g.history.push({board:[...g.board],notes:structuredClone(g.notes)});
      if(action==='move'){
        if(value!==g.board[index]&&value!==0&&value!==g.solution[index])g.mistakes++;
        g.board[index]=value;g.notes[index]=[];
      } else if(value){g.notes[index]=g.notes[index].includes(value)?g.notes[index].filter(n=>n!==value):[...g.notes[index],value].sort();}
      else g.notes[index]=[];
    } else if(action==='undo'){
      const previous=g.history.pop();if(previous){g.board=previous.board;g.notes=previous.notes;}
    } else if(action==='powerup'){
      if(!powerupsAllowed)throw new Error('Your teacher has turned off power-ups.');
      const kind=String(input.kind) as 'hint'|'scan'|'freeze';
      if(!['hint','scan','freeze'].includes(kind)||g.powerups[kind]<=0)throw new Error('No uses left for that power-up.');
      g.powerups[kind]--;g.usedPowerups=true;
      if(kind==='hint'){
        const target=Number.isInteger(index)&&index>=0&&index<g.board.length&&!g.puzzle[index]&&g.board[index]!==g.solution[index]?index:g.board.findIndex((v,i)=>v!==g.solution[i]);
        if(target<0)throw new Error('The board is already solved.');
        g.history.push({board:[...g.board],notes:structuredClone(g.notes)});g.board[target]=g.solution[target];g.notes[target]=[];g.hints++;
      } else if(kind==='scan'){scan=g.board.flatMap((v,i)=>v&&v!==g.solution[i]?[i]:[]);g.scans++;}
      else {g.freezeUntil=Math.max(now,g.freezeUntil)+30000;g.freezes++;}
    } else throw new Error('Unknown game action.');
  }
  g.history=g.history.slice(-100);
  const blanks=g.puzzle.filter(n=>!n).length;
  g.progress=Math.round(g.board.filter((v,i)=>!g.puzzle[i]&&v===g.solution[i]).length/Math.max(1,blanks)*100);
  if(isComplete(g.board,g.solution))g.status='completed';
  g.updatedAt=now;g.revision++;
  return {game:g,scan};
}
export function earnedCoins(game:StoredGame){return completionCoins(game.levelId,game.mistakes);}
