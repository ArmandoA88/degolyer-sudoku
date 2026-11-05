/**
 * Local shared-database/name-selection integration check. Creates two fixture
 * students with identical display names, games, and a record. Never hosted data.
 * Run after local migrations/API are ready:
 *   node tests/name-persistence-smoke.mjs http://127.0.0.1:5173
 */
import assert from 'node:assert/strict';

const target = new URL(process.argv[2] || process.env.SUDOKU_BASE_URL || 'http://127.0.0.1:5173');
assert.ok(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'This fixture test is restricted to HTTP localhost.');
const base = target.origin;
const tag = Date.now().toString(36).slice(-6).toUpperCase();
const displayName = `Name Test ${tag}`;
const pin = '8246', duplicatePin = '9362';

function newDevice() {
  const jar = new Map();
  return async function request(payload, path = '/api/game', allowError = false) {
    const response = await fetch(new URL(path, base), {
      method: payload === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: {origin:base, ...(payload === undefined ? {} : {'content-type':'application/json'}), ...(jar.size ? {cookie:[...jar].map(([key,value])=>`${key}=${value}`).join('; ')} : {})},
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    for(const value of response.headers.getSetCookie()) {
      const pair=value.split(';',1)[0], split=pair.indexOf('=');
      if(split>0)jar.set(pair.slice(0,split),pair.slice(split+1));
    }
    const raw=await response.text();
    let body;
    try{body=raw?JSON.parse(raw):{};}catch{body={raw:raw.slice(0,500)};}
    if(!allowError)assert.ok(response.ok&&!body.error,`${payload?.action||path} failed (${response.status}): ${JSON.stringify(body)}`);
    return {status:response.status,body};
  };
}
const teacher=newDevice(), firstDevice=newDevice();
const act=async(device,payload)=>(await device(payload)).body;
const get=async device=>(await device()).body;
const pass=message=>console.log(`PASS ${message}`);

function assertPrivateFailure(result,label) {
  assert.ok(result.status>=400&&typeof result.body.error==='string',`${label} should return an HTTP error`);
  assert.deepEqual(Object.keys(result.body),['error'],`${label} must not include student data or server details`);
  for(const secret of [pin,duplicatePin,'pin_hash','PBKDF2','SELECT ','INSERT ','stack','solution'])assert.ok(!JSON.stringify(result.body).includes(secret),`${label} leaked ${secret}`);
}

function solve(game) {
  const board=[...game.puzzle],{size,boxRows,boxCols}=game;
  function visit() {
    const index=board.indexOf(0);if(index<0)return true;
    const row=Math.floor(index/size),col=index%size;
    for(let value=1;value<=size;value++) {
      let valid=true;
      for(let i=0;i<size;i++)if(board[row*size+i]===value||board[i*size+col]===value)valid=false;
      for(let r=Math.floor(row/boxRows)*boxRows;r<Math.floor(row/boxRows)*boxRows+boxRows;r++)for(let c=Math.floor(col/boxCols)*boxCols;c<Math.floor(col/boxCols)*boxCols+boxCols;c++)if(board[r*size+c]===value)valid=false;
      if(!valid)continue;board[index]=value;if(visit())return true;
    }
    board[index]=0;return false;
  }
  assert.ok(visit(),'fixture puzzle must be solvable');return board;
}

const signin=await teacher(undefined,'/signin-with-chatgpt?return_to=/',true);
assert.ok([200,302,303,307,308].includes(signin.status),'local teacher mock sign-in must be available');
let t=await get(teacher);
assert.ok(t.user,'teacher mock sign-in must establish identity');
if(!t.classroom)t=await act(teacher,{action:'setup',name:'DeGolyer ES · Local Name Test',teacherName:'Local Test Teacher'});
assert.ok(t.isTeacher&&t.classroom);
const classCode=t.classroom.code;
const firstCode=`NA${tag}`,secondCode=`NB${tag}`;
t=await act(teacher,{action:'saveStudent',student:{name:displayName,code:firstCode,pin,avatar:'🐼',theme:'mint',levelId:'mini',goal:3}});
const first=t.dashboard.students.find(s=>s.code===firstCode);
assert.ok(first);
t=await act(teacher,{action:'saveStudent',student:{name:displayName,code:secondCode,pin:duplicatePin,avatar:'🌻',theme:'rose',levelId:'mini',goal:3}});
const duplicate=t.dashboard.students.find(s=>s.code===secondCode);
assert.ok(duplicate&&duplicate.id!==first.id);
assert.equal(duplicate.name,first.name);

const rosterDevice=newDevice();
let roster=await act(rosterDevice,{action:'roster',classCode});
assert.deepEqual(Object.keys(roster).sort(),['classroom','students']);
assert.deepEqual(Object.keys(roster.classroom),['name']);
assert.equal(roster.classroom.name,t.classroom.name);
for(const row of roster.students)assert.deepEqual(Object.keys(row).sort(),['avatar','id','name'],'public roster must contain only minimal name-picker fields');
const matching=roster.students.filter(row=>row.name===displayName);
assert.equal(matching.length,2);
assert.deepEqual(matching.map(row=>row.id).sort(),[first.id,duplicate.id].sort());
pass('minimal class roster supports duplicate display names with distinct stable IDs');

const unknownClass=await newDevice()({action:'roster',classCode:`UNKNOWN-${tag}`},'/api/game',true);
assertPrivateFailure(unknownClass,'unknown classroom roster');
const wrongDevice=newDevice();
const wrong=await wrongDevice({action:'login',classCode,studentId:first.id,pin:'0000'},'/api/game',true);
assertPrivateFailure(wrong,'wrong selected-student PIN');
let anonymous=await get(wrongDevice);
assert.equal(anonymous.student,null);assert.equal(anonymous.game,null);assert.deepEqual(anonymous.records,[]);
pass('unknown class and wrong PIN expose no roster, board, records, or server secrets');

let s=await act(firstDevice,{action:'login',classCode,studentId:first.id,pin});
assert.equal(s.student.id,first.id);
s=await act(firstDevice,{action:'start',levelId:'mini'});
const solution=solve(s.game);
for(let i=0;i<solution.length;i++)if(!s.game.puzzle[i])s=await act(firstDevice,{action:'move',index:i,value:solution[i]});
assert.equal(s.game.status,'completed');assert.equal(s.student.totalSolved,1);
assert.ok(s.student.coins>0);assert.equal(typeof s.student.best.mini,'number');
assert.equal(s.records.length,1);assert.equal(s.records[0].studentId,first.id);
s=await act(firstDevice,{action:'profile',avatar:'🦊',theme:'violet'});
s=await act(firstDevice,{action:'start',levelId:'mini'});
const nextSolution=solve(s.game),empty=s.game.puzzle.flatMap((v,i)=>!v?[i]:[]);
assert.ok(empty.length>=2);
s=await act(firstDevice,{action:'move',index:empty[0],value:nextSolution[empty[0]]});
s=await act(firstDevice,{action:'note',index:empty[1],value:nextSolution[empty[1]]});
s=await act(firstDevice,{action:'pause'});
const saved=structuredClone(s);
assert.equal(saved.game.status,'paused');
assert.ok(saved.game.notes[empty[1]].length>0);
await act(firstDevice,{action:'logout'});
assert.equal((await get(firstDevice)).student,null);
pass('clean completion saves coins, personal best, record, profile, and next puzzle with notes');

const secondDevice=newDevice();
roster=await act(secondDevice,{action:'roster',classCode});
assert.equal(roster.students.find(row=>row.id===first.id).avatar,'🦊');
s=await act(secondDevice,{action:'login',classCode,studentId:first.id,pin});
assert.equal(s.student.id,saved.student.id);
assert.deepEqual(s.game,saved.game,'a fresh device must restore the exact paused puzzle, board, notes, timer, and counters');
for(const field of ['coins','totalSolved','streak','best','avatar','theme','levelId','goal'])assert.deepEqual(s.student[field],saved.student[field],`fresh device must restore ${field}`);
assert.deepEqual(s.records,saved.records,'records must come from the shared database');
pass('a separate device restores the same student, exact game state, bests, coins, profile, and records');

const duplicateDevice=newDevice();
const duplicateWrong=await duplicateDevice({action:'login',classCode,studentId:duplicate.id,pin},'/api/game',true);
assertPrivateFailure(duplicateWrong,'other duplicate-name student PIN');
const d=await act(duplicateDevice,{action:'login',classCode,studentId:duplicate.id,pin:duplicatePin});
assert.equal(d.student.id,duplicate.id);assert.equal(d.student.name,saved.student.name);
assert.equal(d.student.coins,0);assert.equal(d.student.totalSolved,0);assert.deepEqual(d.student.best,{});
assert.deepEqual(d.records,[]);assert.equal(d.game,null);
pass('identical names keep separate PINs, game state, records, coins, and bests');

const renamed=`Renamed ${tag}`;
t=await act(teacher,{action:'saveStudent',student:{id:first.id,name:renamed,code:firstCode,avatar:s.student.avatar,theme:s.student.theme,levelId:s.student.levelId,goal:s.student.goal}});
const afterRename=t.dashboard.students.find(row=>row.id===first.id);
assert.equal(afterRename.name,renamed);
assert.equal(afterRename.id,first.id);
assert.deepEqual(afterRename.best,saved.student.best);assert.equal(afterRename.coins,saved.student.coins);assert.equal(afterRename.totalSolved,saved.student.totalSolved);
s=await get(secondDevice);
assert.equal(s.student.id,first.id);assert.equal(s.student.name,renamed);
assert.deepEqual(s.game,saved.game);assert.deepEqual(s.records,saved.records);
await act(secondDevice,{action:'logout'});
const thirdDevice=newDevice();
roster=await act(thirdDevice,{action:'roster',classCode});
assert.equal(roster.students.find(row=>row.id===first.id).name,renamed);
s=await act(thirdDevice,{action:'login',classCode,studentId:first.id,pin});
assert.equal(s.student.name,renamed);assert.equal(s.student.id,first.id);
assert.deepEqual(s.game,saved.game);assert.deepEqual(s.records,saved.records);
assert.equal(s.student.coins,saved.student.coins);assert.deepEqual(s.student.best,saved.student.best);
pass('teacher rename retains stable identity, PIN, game, records, coins, and personal best across new-device login');
console.log(`Name persistence smoke test passed. Local fixture IDs: ${first.id} (${renamed}); ${duplicate.id} (${displayName}).`);
