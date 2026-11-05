/**
 * Local database integration smoke test. Creates one clearly named test student,
 * temporary classroom reward, games, and records. Never runs against a hosted URL.
 * Run only after the API and local D1 migrations are ready:
 *   node tests/classroom-smoke.mjs http://localhost:3000
 */
import assert from 'node:assert/strict';

const target = new URL(process.argv[2] || process.env.SUDOKU_BASE_URL || 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && target.protocol === 'http:', 'This destructive fixture script is restricted to an explicit HTTP localhost URL.');
const base = target.origin;
const tag = Date.now().toString(36).slice(-6).toUpperCase();
const studentCode = `SM${tag}`;
const pin = '8246';

function client() {
  const cookies = new Map();
  return async function request(path = '/api/game', payload, options = {}) {
    const response = await fetch(new URL(path, base), {
      method: payload === undefined ? 'GET' : 'POST',
      redirect: 'manual',
      headers: {
        origin: base,
        ...(payload === undefined ? {} : {'content-type': 'application/json'}),
        ...(cookies.size ? {cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ')} : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    for (const entry of response.headers.getSetCookie()) {
      const pair = entry.split(';', 1)[0];
      const equal = pair.indexOf('=');
      if (equal > 0) cookies.set(pair.slice(0,equal), pair.slice(equal+1));
    }
    let body;
    const text = await response.text();
    try { body = text ? JSON.parse(text) : {}; } catch { body = {raw: text.slice(0,500)}; }
    if (!options.allowError) assert.ok(response.ok && !body.error, `${payload?.action || path} failed (${response.status}): ${JSON.stringify(body)}`);
    return {status: response.status, body, headers: response.headers};
  };
}
const teacher = client(), student = client(), anonymous = client();
const action = async (who, payload) => (await who('/api/game', payload)).body;
const state = async who => (await who()).body;
const rejected = async (who, payload, label) => {
  const result = await who('/api/game', payload, {allowError:true});
  assert.ok(result.status >= 400 && result.body.error, `${label} must reject with an HTTP error; received ${result.status}`);
};
const pass = text => console.log(`PASS ${text}`);

function solve(game) {
  const board = [...game.puzzle];
  const {size,boxRows,boxCols} = game;
  function next() {
    const index = board.indexOf(0);
    if (index < 0) return true;
    const row = Math.floor(index / size), col = index % size;
    for (let value = 1; value <= size; value++) {
      let valid = true;
      for (let i = 0; i < size; i++) if (board[row*size+i] === value || board[i*size+col] === value) valid = false;
      for (let r = Math.floor(row/boxRows)*boxRows; r < Math.floor(row/boxRows)*boxRows+boxRows; r++) {
        for (let c = Math.floor(col/boxCols)*boxCols; c < Math.floor(col/boxCols)*boxCols+boxCols; c++) if (board[r*size+c] === value) valid = false;
      }
      if (!valid) continue;
      board[index] = value;
      if (next()) return true;
    }
    board[index] = 0;
    return false;
  }
  assert.ok(next(), 'generated puzzle must be solvable');
  return board;
}

let originalSettings, temporaryPrizeId, studentId;
try {
  const signin = await teacher('/signin-with-chatgpt?return_to=/', undefined, {allowError:true});
  assert.ok([200,302,303,307,308].includes(signin.status), 'local mock sign-in route must be available');
  let t = await state(teacher);
  assert.ok(t.user, 'local mock sign-in must establish teacher identity');
  if (!t.classroom) t = await action(teacher,{action:'setup',name:'DeGolyer ES · Local Smoke Class',teacherName:'Smoke Test Teacher'});
  assert.ok(t.isTeacher && t.classroom, 'teacher owns a configured classroom');
  originalSettings = structuredClone(t.classroom);
  const code = t.classroom.code;
  temporaryPrizeId = `smoke-${tag}`;
  const prize = {id:temporaryPrizeId,name:`Local smoke badge ${tag}`,description:'Temporary automated local-test reward',cost:1,icon:'⭐'};
  t = await action(teacher,{action:'settings',settings:{...t.classroom,powerups:true,prizes:[...t.classroom.prizes,prize]}});
  pass('teacher authentication, classroom setup, and custom prize settings');

  await rejected(anonymous,{action:'settings',settings:{name:'Unauthorized'}},'anonymous settings write');
  await rejected(anonymous,{action:'saveStudent',student:{name:'Unauthorized',code:`NO${tag}`,pin}},'anonymous roster write');
  pass('anonymous teacher mutations are protected');

  t = await action(teacher,{action:'saveStudent',student:{name:`Smoke Student ${tag}`,code:studentCode,pin,avatar:'🦉',theme:'teal',levelId:'mini',goal:3}});
  const created = t.dashboard?.students?.find(s => s.code === studentCode) || (await state(teacher)).dashboard?.students?.find(s => s.code === studentCode);
  assert.ok(created, 'new student appears in teacher dashboard');
  studentId = created.id;
  await rejected(student,{action:'login',classCode:code,studentCode,pin:'0000'},'wrong student PIN');
  let s = await action(student,{action:'login',classCode:code,studentCode,pin});
  assert.equal(s.student?.id,studentId);
  assert.equal(s.isTeacher,false);
  assert.equal(s.student.coins,0);
  await rejected(student,{action:'saveStudent',student:{id:studentId,name:'Unauthorized edit'}},'student roster write');
  await rejected(student,{action:'redemption',prizeId:temporaryPrizeId},'insufficient coins redemption');
  await rejected(student,{action:'redemption',prizeId:'nonexistent-reward'},'unknown redemption');
  pass('roster creation, PIN login, role separation, and reward validation');

  s = await action(student,{action:'profile',avatar:s.student.avatar,theme:s.student.theme});
  s = await action(student,{action:'start',levelId:'mini'});
  assert.equal(s.game.size,4);
  assert.equal('solution' in s.game,false,'solution must not be sent to student');
  const answer = solve(s.game);
  const editable = s.game.puzzle.findIndex(value => !value);
  const initialUses = {...s.game.powerups};
  s = await action(student,{action:'note',index:editable,value:answer[editable]});
  assert.ok(s.game.notes[editable].includes(answer[editable]));
  s = await action(student,{action:'undo'});
  assert.equal(s.game.notes[editable].length,0);
  s = await action(student,{action:'pause'});
  assert.equal(s.game.status,'paused');
  await rejected(student,{action:'move',index:editable,value:answer[editable]},'move on paused board');
  s = await action(student,{action:'resume'});
  assert.equal(s.game.status,'playing');
  pass('board generation, private solution, pencil notes, undo, pause, and resume');

  s = await action(student,{action:'help',message:'Local HTTP smoke test: I need help.'});
  t = await state(teacher);
  let monitored = t.dashboard.students.find(row => row.id === studentId);
  assert.ok(monitored.helpRequested && monitored.game, 'teacher sees help request and active board');
  assert.equal('solution' in monitored.game,false);
  await action(teacher,{action:'nudge',studentId,message:'Local smoke: try checking each row.'});
  s = await state(student);
  assert.equal(s.student.teacherNote,'Local smoke: try checking each row.');
  await action(teacher,{action:'resolveHelp',studentId});
  t = await state(teacher);
  assert.equal(t.dashboard.students.find(row => row.id === studentId).helpRequested,false);
  pass('live teacher board, help queue, teacher guidance, and help resolution');

  s = await action(student,{action:'move',index:editable,value:answer[editable] % s.game.size + 1});
  assert.equal(s.game.mistakes,1);
  s = await action(student,{action:'powerup',kind:'scan'});
  assert.ok(s.scan.includes(editable));
  assert.equal(s.game.powerups.scan,initialUses.scan-1);
  s = await action(student,{action:'undo'});
  s = await action(student,{action:'powerup',kind:'hint',index:editable});
  assert.equal(s.game.board[editable],answer[editable]);
  assert.equal(s.game.powerups.hint,initialUses.hint-1);
  s = await action(student,{action:'powerup',kind:'freeze'});
  assert.equal(s.game.powerups.freeze,initialUses.freeze-1);
  await rejected(student,{action:'powerup',kind:'freeze'},'exhausted freeze');
  for (let i=0;i<answer.length;i++) if(s.game.board[i]!==answer[i]) s=await action(student,{action:'move',index:i,value:answer[i]});
  assert.equal(s.game.status,'completed');
  assert.equal(s.student.totalSolved,1);
  assert.ok(s.student.coins>0);
  assert.ok(s.records.some(r=>r.studentId===studentId && r.levelId==='mini' && r.assisted));
  const afterFirstCoins=s.student.coins;
  pass('mistakes, scan, hint, freeze limits, completion, assisted record, and earned coins');

  s=await action(student,{action:'start',levelId:'mini'});
  const cleanAnswer=solve(s.game);
  for(let i=0;i<cleanAnswer.length;i++) if(!s.game.puzzle[i]) s=await action(student,{action:'move',index:i,value:cleanAnswer[i]});
  assert.equal(s.game.status,'completed');
  assert.equal(s.student.totalSolved,2);
  assert.ok(s.student.coins>afterFirstCoins);
  assert.equal(typeof s.student.best.mini,'number');
  assert.ok(s.records.some(r=>r.studentId===studentId && !r.assisted));
  const beforeRedeem=s.student.coins;
  s=await action(student,{action:'redemption',prizeId:temporaryPrizeId});
  assert.equal(s.student.coins,beforeRedeem-1);
  const redemption=s.redemptions.find(r=>r.studentId===studentId&&r.prizeName===prize.name);
  assert.ok(redemption && redemption.status==='pending');
  await rejected(student,{action:'fulfill',redemptionId:redemption.id,status:'delivered'},'student prize approval');
  t=await action(teacher,{action:'fulfill',redemptionId:redemption.id,status:'approved'});
  assert.equal(t.dashboard.redemptions.find(r=>r.id===redemption.id).status,'approved');
  t=await action(teacher,{action:'fulfill',redemptionId:redemption.id,status:'delivered'});
  assert.equal(t.dashboard.redemptions.find(r=>r.id===redemption.id).status,'delivered');
  assert.ok(t.dashboard.records.filter(r=>r.studentId===studentId).length>=2);
  assert.ok(t.dashboard.activity.some(a=>a.studentId===studentId));
  pass('clean personal best, prize purchase, teacher fulfillment, records, and activity feed');

  await action(student,{action:'logout'});
  s=await state(student);
  assert.equal(s.student,null);
  pass('student logout');
  console.log(`Local classroom smoke test passed. Fixture student: ${studentCode}; id: ${studentId}.`);
} finally {
  if(originalSettings) {
    await action(teacher,{action:'settings',settings:originalSettings});
    console.log('Restored original classroom settings and prize catalog. Local fixture student and records remain.');
  }
}
