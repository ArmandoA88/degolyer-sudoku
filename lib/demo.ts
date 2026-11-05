import { generatePuzzle, LEVELS, isComplete } from './sudoku';
import type { AppState, Game, Student, DashboardStudent, ScoreRecord } from './types';
export type DemoState = AppState & {demoSolution:number[];demoHistory:{board:number[];notes:number[][]}[];demoFreezeUntil:number};
export const AVATARS=['🦊','🐼','🐸','🦁','🐨','🐰','🦉','🐱'];
export const THEMES=['lime','coral','lavender'];
export const levelName=(id:string)=>LEVELS.find(l=>l.id===id)?.name||id;
export const timeText=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
export const makeGame=(levelId='easy',seed=Date.now()):{game:Game;solution:number[]}=>{const p=generatePuzzle(levelId,seed);return {solution:p.solution,game:{id:`demo-${seed}`,levelId,size:p.size,boxRows:p.boxRows,boxCols:p.boxCols,puzzle:p.puzzle,board:[...p.puzzle],notes:p.puzzle.map(()=>[]),elapsed:0,mistakes:0,hints:0,scans:0,freezes:0,status:'playing',startedAt:Date.now(),updatedAt:Date.now(),progress:0,powerups:{hint:3,scan:2,freeze:1},usedPowerups:false,revision:0}}};
export function createDemo():DemoState{
 const now=Date.now(), {game,solution}=makeGame('easy',205);let fill=0;for(let i=0;i<game.board.length;i++)if(!game.board[i]&&fill++<6)game.board[i]=solution[i];game.elapsed=224;game.progress=30;
 const names=['Maya R.','Leo M.','Sofia G.','Ethan J.','Isabella A.','Noah T.'];
 const students:DashboardStudent[]=names.map((name,i)=>({id:`demo-${i}`,name,code:name.split(' ')[0].toLowerCase(),avatar:AVATARS[i],theme:'lime',levelId:i>3?'medium':'easy',goal:2,coins:[240,190,320,80,160,125][i],totalSolved:[12,9,18,4,8,6][i],streak:[3,2,5,0,2,1][i],best:{mini:98+i*12,easy:262+i*31},lastSeen:i===5?now-3600000:now-i*1200,helpRequested:i===3,teacherNote:'',game:i===0?game:{...makeGame(i>3?'medium':'easy',401+i).game,elapsed:180+i*47,mistakes:i===3?4:i%2,progress:[30,65,80,25,45,0][i]},activity:[]}));
 const records:ScoreRecord[]=Array.from({length:15},(_,i)=>({id:`r${i}`,studentId:`demo-${i%6}`,studentName:names[i%6],levelId:i%4===0?'mini':'easy',seconds:190+i*19,mistakes:i%3,hints:i%4===0?1:0,coins:35,assisted:i%4===0,completedAt:now-i*3700000}));
 records.unshift({id:'today-maya',studentId:'demo-0',studentName:names[0],levelId:'mini',seconds:98,mistakes:0,hints:0,coins:25,assisted:false,completedAt:now-1800000});
 const activity=[{id:'a1',studentId:'demo-2',studentName:names[2],text:'finished an Explorer puzzle',at:now-90000},{id:'a2',studentId:'demo-3',studentName:names[3],text:'asked for a little help',at:now-150000},{id:'a3',studentId:'demo-0',studentName:names[0],text:'started an Explorer puzzle',at:now-224000},{id:'a4',studentId:'demo-1',studentName:names[1],text:'used a Hint power-up',at:now-300000}];
 return {user:null,classroom:{id:'demo',name:'Our puzzle classroom',teacherName:'DeGolyer ES Teacher',code:'DEG205',powerups:true,leaderboard:true,prizes:[{id:'p1',name:'Sticker surprise',description:'Pick a special sticker from your teacher’s collection.',cost:75,icon:'🌈'},{id:'p2',name:'Classroom helper',description:'Be the teacher’s special helper for one day.',cost:150,icon:'🌱'},{id:'p3',name:'Choose the brain break',description:'Choose a teacher-approved class brain break.',cost:250,icon:'🎨'},{id:'p4',name:'Puzzle champion',description:'Earn a digital champion badge for your collection.',cost:100,icon:'🏅'},{id:'p5',name:'Book nook time',description:'Enjoy a little extra independent reading time.',cost:200,icon:'📚'},{id:'p6',name:'Positive note home',description:'Celebrate your hard work with a happy note home.',cost:125,icon:'💌'}]},isTeacher:true,student:students[0],game,records:records.filter(r=>r.studentId==='demo-0'),leaderboard:students.map(s=>({studentId:s.id,name:s.name,solved:s.totalSolved,coins:s.coins})).sort((a,b)=>b.solved-a.solved),redemptions:[],dashboard:{students,records,redemptions:[],activity},demoSolution:solution,demoHistory:[],demoFreezeUntil:0};
}
export function demoAction(current:DemoState,p:any):DemoState{
 const s:DemoState=structuredClone(current),g=s.game,st=s.student,now=Date.now();s.scan=undefined;
 const activity=(text:string,id=st?.id,name=st?.name)=>{if(s.dashboard&&id&&name)s.dashboard.activity.unshift({id:`a${now}`,studentId:id,studentName:name,text,at:now})};
 if(g&&typeof p.elapsed==='number')g.elapsed=Math.floor(p.elapsed);
 if(p.action==='start'){const n=makeGame(p.levelId);s.game=n.game;s.demoSolution=n.solution;s.demoHistory=[];s.demoFreezeUntil=0;activity(`started a ${levelName(p.levelId)} puzzle`)}
 if(p.action==='pause'&&g)g.status='paused';if(p.action==='resume'&&g)g.status='playing';
 if(p.action==='profile'&&st){st.avatar=p.avatar;st.theme=p.theme}
 if(p.action==='help'&&st){st.helpRequested=true;activity('asked for a little help')}
 if(p.action==='note'&&g&&g.status==='playing'&&!g.puzzle[p.index]&&!g.board[p.index]){s.demoHistory.push({board:[...g.board],notes:structuredClone(g.notes)});const notes=g.notes[p.index];g.notes[p.index]=notes.includes(p.value)?notes.filter(n=>n!==p.value):[...notes,p.value].sort()}
 if(p.action==='undo'&&g){const h=s.demoHistory.pop();if(h){g.board=h.board;g.notes=h.notes}}
 if(p.action==='move'&&g&&g.status==='playing'&&!g.puzzle[p.index]){s.demoHistory.push({board:[...g.board],notes:structuredClone(g.notes)});g.board[p.index]=p.value;g.notes[p.index]=[];if(p.value&&p.value!==s.demoSolution[p.index])g.mistakes++}
 if(p.action==='powerup'&&g&&s.classroom?.powerups&&g.status==='playing'){
  const k=p.kind as 'hint'|'scan'|'freeze';if(g.powerups[k]<=0)throw new Error('You’ve used this power-up for this puzzle.');g.powerups[k]--;g.usedPowerups=true;
  if(k==='hint'){let i=Number.isInteger(p.index)&&!g.puzzle[p.index]&&g.board[p.index]!==s.demoSolution[p.index]?p.index:g.board.findIndex((n,i)=>n!==s.demoSolution[i]);if(i>=0){s.demoHistory.push({board:[...g.board],notes:structuredClone(g.notes)});g.board[i]=s.demoSolution[i];g.notes[i]=[];g.hints++}}
  if(k==='scan'){s.scan=g.board.flatMap((n,i)=>n&&n!==s.demoSolution[i]?[i]:[]);g.scans++}
  if(k==='freeze'){s.demoFreezeUntil=now+30000;g.freezes++;(g as any).freezeRemaining=30}activity(`used a ${k} power-up`)
 }
 if(g&&s.game===g&&st){const blanks=g.puzzle.filter(n=>!n).length;g.progress=Math.round(g.board.filter((n,i)=>!g.puzzle[i]&&n===s.demoSolution[i]).length/blanks*100);if(g.status==='playing'&&isComplete(g.board,s.demoSolution)){g.status='completed';const coins=(LEVELS.find(l=>l.id===g.levelId)?.baseCoins||35)+(g.mistakes===0?10:0);st.coins+=coins;st.totalSolved++;st.streak=g.mistakes===0?st.streak+1:0;if(!g.usedPowerups)st.best[g.levelId]=Math.min(st.best[g.levelId]||Infinity,g.elapsed);const r={id:`r${now}`,studentId:st.id,studentName:st.name,levelId:g.levelId,seconds:g.elapsed,mistakes:g.mistakes,hints:g.hints,coins,assisted:g.usedPowerups,completedAt:now};s.records.unshift(r);s.dashboard?.records.unshift(r);activity(`finished a ${levelName(g.levelId)} puzzle`)}}
 if(p.action==='redemption'&&st){const prize=s.classroom?.prizes.find(pz=>pz.id===p.prizeId);if(!prize||st.coins<prize.cost)throw new Error('Keep solving to earn a few more coins.');st.coins-=prize.cost;const r={id:`red${now}`,studentId:st.id,studentName:st.name,prizeName:prize.name,cost:prize.cost,status:'pending' as const,createdAt:now};s.redemptions.unshift(r);s.dashboard?.redemptions.unshift(r);activity(`requested ${prize.name}`)}
 if(p.action==='saveStudent'&&s.dashboard){const n=p.student;const existing=s.dashboard.students.find(v=>v.id===n.id);if(existing)Object.assign(existing,n);else s.dashboard.students.push({...n,id:`demo-${now}`,coins:0,totalSolved:0,streak:0,best:{},lastSeen:0,helpRequested:false,teacherNote:'',game:null,activity:[]});}
 if(p.action==='settings'&&s.classroom)Object.assign(s.classroom,p.settings);
 if(p.action==='nudge'&&s.dashboard){const target=s.dashboard.students.find(v=>v.id===p.studentId);if(target){target.teacherNote=p.message;if(target.id===st?.id)st.teacherNote=p.message;activity('received a teacher encouragement',target.id,target.name)}}
 if(p.action==='resolveHelp'&&s.dashboard){const target=s.dashboard.students.find(v=>v.id===p.studentId);if(target){target.helpRequested=false;if(st?.id===target.id)st.helpRequested=false}}
 if(p.action==='fulfill'){const r=s.dashboard?.redemptions.find(v=>v.id===p.redemptionId);if(r)r.status=p.status;const r2=s.redemptions.find(v=>v.id===p.redemptionId);if(r2)r2.status=p.status}
 if(st&&s.dashboard){const i=s.dashboard.students.findIndex(v=>v.id===st.id);if(i>=0)s.dashboard.students[i]={...s.dashboard.students[i],...st,game:s.game,lastSeen:now}}
 return s;
}
