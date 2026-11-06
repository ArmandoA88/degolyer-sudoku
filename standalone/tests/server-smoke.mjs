/**
 * Standalone Windows EXE integration test. Creates only isolated local fixtures.
 * Run: node standalone/tests/server-smoke.mjs [absolute-path-to-server.exe]
 * The single copied EXE is run offline without Node or adjacent tunnel helpers,
 * from folders containing spaces. Online startup is checked separately.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {closeSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,openSync,readSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

assert.equal(process.platform,'win32','This integration test exercises the Windows executable.');
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const originalExe=path.resolve(process.argv[2]||path.join(project,'..','DeGolyer-Sudoku-Server.exe'));
assert.ok(existsSync(originalExe),'Build the standalone server EXE before running this test.');
const executableFile=openSync(originalExe,'r'),header=Buffer.alloc(2);readSync(executableFile,header,0,2,0);closeSync(executableFile);
assert.equal(header.toString(),'MZ','Output must be a real Windows executable.');
const outputs=path.join(project,'outputs');mkdirSync(outputs,{recursive:true});
const fixture=mkdtempSync(path.join(outputs,'standalone smoke '));
const portableDir=path.join(fixture,'Portable server copy');mkdirSync(portableDir);
const copiedExe=path.join(portableDir,'DeGolyer Sudoku Server.exe');copyFileSync(originalExe,copiedExe);
assert.equal(existsSync(path.join(portableDir,'cloudflared.exe')),false,'A portable installation must need only the server EXE.');
const help=spawnSync(copiedExe,['--help'],{cwd:portableDir,windowsHide:true,encoding:'utf8',shell:false});
assert.equal(help.status,0);assert.match(help.stdout,/--offline/,'Single-file online startup must document an explicit offline option.');
const cwdA=path.join(fixture,'First unrelated working folder'),cwdB=path.join(fixture,'Second unrelated working folder');
mkdirSync(cwdA);mkdirSync(cwdB);
const dataDir=path.join(portableDir,'SudokuData');
const pin='8246';
const sampleContent=/Maya R\.|Leo M\.|Sofia G\.|Ethan J\.|Isabella A\.|Noah T\.|Demo classroom|Example scores stay on this device|demoSolution|demoHistory/i;
const retiredClassUi=/\b(?:classroom|class)\s+code\b|[?&]class=/i;
const registrationPayload=/(?:\baction|["'\x60]action["'\x60])\s*:\s*["'\x60]register["'\x60]/;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pass=text=>console.log('PASS '+text);
let child,logs='',origin;

async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function start(cwd,explicitLoopback=true){
  const port=await freePort();origin='http://127.0.0.1:'+port;logs='';
  const env={...process.env,PATH:path.join(process.env.SystemRoot||'C:/Windows','System32')};delete env.NODE_OPTIONS;
  const args=['--port',String(port),'--no-open','--offline',...(explicitLoopback?['--host','127.0.0.1']:[])];
  child=spawn(copiedExe,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
  child.stdout.on('data',v=>logs+=v.toString());child.stderr.on('data',v=>logs+=v.toString());
  let spawnError;child.once('error',error=>spawnError=error);
  for(let i=0;i<150;i++){
    if(spawnError)throw spawnError;
    if(child.exitCode!==null)throw new Error('Server exited before readiness: '+logs.slice(-4000));
    try{const response=await fetch(origin+'/health',{signal:AbortSignal.timeout(500)});if(response.ok)return {port,logs:()=>logs};}catch{}
    await sleep(100);
  }
  throw new Error('Server did not become ready: '+logs.slice(-4000));
}
async function stop(){if(!child)return;const current=child;child=null;if(current.exitCode!==null)return;current.kill('SIGTERM');await Promise.race([new Promise(resolve=>current.once('exit',resolve)),sleep(5000)]);if(current.exitCode===null)current.kill('SIGKILL');}
function device(extraHeaders={}){
  const jar=new Map();
  return async function request(urlPath='/api/game',payload,options={}){
    const headers={origin,...extraHeaders,...options.headers};
    if(jar.size)headers.cookie=[...jar].map(([key,value])=>key+'='+value).join('; ');
    const body=options.form?new URLSearchParams(options.form).toString():payload===undefined?undefined:JSON.stringify(payload);
    if(body!==undefined)headers['content-type']=options.form?'application/x-www-form-urlencoded':'application/json';
    const response=await fetch(new URL(urlPath,origin),{method:body===undefined?'GET':'POST',redirect:'manual',headers,body,signal:AbortSignal.timeout(10000)});
    for(const value of response.headers.getSetCookie()){
      const pair=value.split(';',1)[0],equal=pair.indexOf('=');if(equal>0)jar.set(pair.slice(0,equal),pair.slice(equal+1));
    }
    const raw=await response.text();let data;try{data=raw?JSON.parse(raw):{};}catch{data={html:raw};}
    if(!options.allowError)assert.ok(response.status<400&&!data.error,`${payload?.action||urlPath} failed (${response.status}): ${JSON.stringify(data).slice(0,600)}`);
    return {response,status:response.status,data,raw};
  };
}
const action=async(client,payload)=>(await client('/api/game',payload)).data;
const state=async(client)=>(await client()).data;
function teacherDevice(extraHeaders={}){
  const client=device(extraHeaders);
  return (urlPath='/api/game',payload,options)=>client(urlPath==='/api/game'?'/teacher/api/game':urlPath,payload,options);
}
async function openTeacher(client){
  const previous=await state(client);
  for(const route of ['/teacher','/teacher/']){
    const page=await client(route);
    assert.equal(page.status,200);assert.match(page.response.headers.get('content-type')??'',/^text\/html\b/i);
    assert.match(page.raw,/Sudoku Studio/);assert.doesNotMatch(page.raw,/<form\b|name=["']password["']|dg_teacher_csrf/i,'The teacher route must open the app without a password form.');
    assert.equal(page.response.headers.getSetCookie().some(cookie=>cookie.startsWith('dg_teacher=')),false,'Opening the dashboard must not create a teacher login cookie.');
    const stale=await client(route,undefined,{form:{mode:'setup',password:'Retired-ignored-fixture',confirmPassword:'Retired-ignored-fixture',csrf:'retired-token',setupToken:'retired-setup'},allowError:true});
    assert.equal(stale.status,303,'An old teacher password form must reopen the dashboard instead of requiring login.');assert.equal(stale.response.headers.get('location'),'/teacher');
    assert.equal(stale.response.headers.getSetCookie().some(cookie=>cookie.startsWith('dg_teacher=')),false,'A stale password form must not create a teacher session.');
  }
  const current=await state(client);assert.ok(current.user,'The local teacher API must work directly without logging in.');assert.deepEqual(current.classroom,previous.classroom,'Discarding an old password form must preserve the classroom.');return current;
}
function solve(game){
  const board=[...game.puzzle],{size,boxRows,boxCols}=game;
  function visit(){const index=board.indexOf(0);if(index<0)return true;const row=Math.floor(index/size),col=index%size;
    for(let value=1;value<=size;value++){let valid=true;for(let i=0;i<size;i++)if(board[row*size+i]===value||board[i*size+col]===value)valid=false;
      for(let r=Math.floor(row/boxRows)*boxRows;r<Math.floor(row/boxRows)*boxRows+boxRows;r++)for(let c=Math.floor(col/boxCols)*boxCols;c<Math.floor(col/boxCols)*boxCols+boxCols;c++)if(board[r*size+c]===value)valid=false;
      if(!valid)continue;board[index]=value;if(visit())return true;}board[index]=0;return false;}
  assert.ok(visit(),'Generated puzzle must have a solution.');return board;
}

try{
  await start(cwdA);
  assert.equal(logs.includes('/teacher?setup='),false,'Teacher access must not require a setup code.');
  const anonymous=device(),spoofed=device({'oai-authenticated-user-id':'standalone-teacher','oai-authenticated-user-email':'local-teacher@degolyer.invalid'});
  const before=await state(spoofed);assert.equal(before.user,null);assert.equal(before.isTeacher,false);
  assert.equal(before.classroom,null,'A fresh server must start without a fabricated classroom.');
  assert.equal(before.student,null);assert.equal(before.game,null);
  for(const key of ['records','leaderboard','redemptions'])assert.deepEqual(before[key],[],'Fresh '+key+' must be empty.');
  assert.equal(before.dashboard,undefined,'A fresh server must not contain a fake teacher dashboard.');
  assert.equal(sampleContent.test(JSON.stringify(before)),false,'Fresh server state must not contain sample records.');
  assert.deepEqual((await anonymous('/api/game',{action:'roster'})).data,{classroom:null,students:[]},'The unconfigured single classroom must return an empty name picker without a class code.');
  const beforeSetup=await anonymous('/api/game',{action:'register',name:'New Learner',pin:'7529'},{allowError:true});
  assert.equal(beforeSetup.status,409,'Student sign-up must wait until the teacher sets up the classroom.');assert.deepEqual(Object.keys(beforeSetup.data),['error']);
  pass('fresh server starts with an empty classroom, roster, game, records, and rewards');
  const teacher=teacherDevice();let t=await openTeacher(teacher);
  assert.equal(t.isTeacher,false,'A new teacher page must show classroom setup before a classroom exists.');
  for(const headers of [{origin:'http://untrusted.invalid'},{'sec-fetch-site':'cross-site'},{origin:'null','sec-fetch-site':'same-origin'}]){
    const rejected=await teacher('/api/game',{action:'setup',name:'Rejected classroom',teacherName:'Rejected Teacher'},{headers,allowError:true});
    assert.equal(rejected.status,403,'Outside requests must not create or change the local classroom.');
  }
  assert.equal((await state(teacher)).classroom,null);
  t=await action(teacher,{action:'setup',name:'EXE Persistence Test',teacherName:'Local Teacher'});
  assert.ok(t.isTeacher&&t.classroom);assert.equal('code' in t.classroom,false,'Classroom JSON must not expose a retired class code.');
  assert.deepEqual(t.classroom.prizes,[],'A newly configured classroom must not contain sample rewards.');
  assert.equal(t.classroom.allowRegistration,true,'New classrooms must allow student name registration by default.');
  const denied=await anonymous('/api/game',{action:'saveStudent',student:{}},{allowError:true});assert.equal(denied.status,403);
  const parallel=await Promise.all(Array.from({length:6},(_,i)=>state(i%2?teacher:spoofed)));
  parallel.forEach((value,i)=>assert.equal(value.isTeacher,!!(i%2),'Parallel requests must retain separate teacher identities.'));
  const oldCookie=device({cookie:'dg_teacher='+'a'.repeat(48)});
  assert.equal((await state(oldCookie)).user,null,'Retired teacher cookies must not authorize the student API.');
  assert.equal((await state(device())).isTeacher,false,'The normal loopback student API must remain separate from teacher controls.');
  pass('copied EXE starts without Node on PATH; teacher dashboard opens without login and its API stays separate from student access');

  const unknownDevice=device(),unknown=await unknownDevice('/api/game',{action:'login',name:'First Time Learner',pin:'0027'},{allowError:true});
  assert.equal(unknown.status,401);assert.equal(unknown.data.code,'ACCOUNT_NOT_FOUND');assert.deepEqual(Object.keys(unknown.data).sort(),['code','error']);
  assert.match(unknown.data.error,/first visit.*Create a new account/i,'An unknown name must explain the explicit first-time account option.');
  assert.equal((await state(teacher)).dashboard.students.length,0,'An unsuccessful login must never create an account.');
  assert.equal((await state(unknownDevice)).student,null);
  const leadingZero=await action(device(),{action:'register',name:'Four Digit Learner',pin:'0027'});
  const leadingZeroLogin=await action(device(),{action:'login',name:'  FOUR   digit learner ',pin:'0027'});
  assert.equal(leadingZeroLogin.student.id,leadingZero.student.id,'Name matching must ignore case/extra spaces and preserve leading-zero PINs.');
  const beforeBadPinCount=(await state(teacher)).dashboard.students.length;
  const wrongPinDevice=device(),wrongPin=await wrongPinDevice('/api/game',{action:'login',name:'Four Digit Learner',pin:'0000'},{allowError:true});
  assert.equal(wrongPin.status,401);assert.equal(wrongPin.data.code,'PIN_INCORRECT');assert.match(wrongPin.data.error,/already has an account.*teacher.*saved/i);
  assert.equal((await state(teacher)).dashboard.students.length,beforeBadPinCount,'An incorrect PIN must not create another account.');
  assert.equal((await state(wrongPinDevice)).student,null);
  for(const invalidPin of ['027','00270','00A7']){
    const rejected=await device()('/api/game',{action:'login',name:'Four Digit Learner',pin:invalidPin},{allowError:true});
    assert.equal(rejected.status,400,'Login must accept exactly four digits.');
  }
  pass('typed name plus four-digit PIN restores existing accounts; unknown names and wrong PINs never create profiles');

  const page=await anonymous('/');assert.match(page.raw,/Sudoku Studio/);assert.equal(sampleContent.test(page.raw),false,'Student landing page must not contain sample profiles.');assert.equal(retiredClassUi.test(page.raw),false,'The one-classroom page must not display class-code controls.');
  const runtimeInfo=await anonymous('/api/server-info');assert.equal(runtimeInfo.data.tunnel.state,'off','Fixture startup must explicitly avoid creating a public tunnel.');
  assert.equal(existsSync(path.join(dataDir,'runtime')),false,'Offline mode must not extract a tunnel helper.');
  const licenses=await anonymous('/licenses.txt');assert.match(licenses.raw,/cloudflared/i,'The one-file package must include its embedded tunnel license notice.');
  const assetPaths=[...page.raw.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(m=>m[1]);
  assert.ok(assetPaths.some(p=>p.endsWith('.js')),'Standalone HTML must reference an embedded JavaScript client.');
  let embeddedRegistration=false;
  for(const asset of assetPaths){assert.ok(asset.startsWith('/'),'Client assets must be local, not CDN URLs.');const r=await anonymous(asset);assert.equal(r.status,200);assert.equal(r.response.headers.get('cache-control'),'no-cache','Fixed asset URLs must revalidate after an EXE upgrade.');assert.ok(r.raw.length>100);assert.equal(sampleContent.test(r.raw),false,'Embedded student assets must not include sample profiles, fake scores, or demo state.');assert.equal(retiredClassUi.test(r.raw),false,'Embedded student assets must not contain class-code prompts or selected-class share URLs.');if(registrationPayload.test(r.raw))embeddedRegistration=true;}
  assert.ok(embeddedRegistration,'The embedded student client must include its real name/PIN registration request.');
  for(const blocked of ['/SudokuData/classroom.sqlite','/package.json','/.env','/app/api/game/route.ts','/..%2fSudokuData%2fclassroom.sqlite','/%2e%2e%2fpackage.json']){
    const result=await anonymous(blocked,undefined,{allowError:true});assert.ok(result.status>=400,blocked+' must not serve internal files.');
  }
  pass('embedded game/CSS/JS are served locally while data, source, and traversal paths are blocked');

  let selfClient=device();
  let signup=await selfClient('/api/game',{action:'register',name:'New Learner',pin:'7529',avatar:'🐬',role:'teacher',isTeacher:true,coins:9999,best:{mini:0},totalSolved:99,streak:99,levelId:'expert',goal:20,theme:'malicious',code:'TEACHER'});
  assert.equal(signup.status,200);let selfState=signup.data;const selfId=selfState.student.id;
  assert.equal(selfState.user,null);assert.equal(selfState.isTeacher,false);assert.equal(selfState.student.name,'New Learner');
  for(const field of ['coins','totalSolved','streak'])assert.equal(selfState.student[field],0,'Registration must not accept forged '+field+'.');
  assert.deepEqual(selfState.student.best,{});assert.deepEqual(selfState.records,[]);assert.deepEqual(selfState.redemptions,[]);assert.equal(selfState.game,null);
  assert.equal(selfState.student.levelId,'easy');assert.equal(selfState.student.goal,2);assert.equal(selfState.student.theme,'navy');assert.equal(selfState.student.avatar,'🐬');
  assert.notEqual(selfState.student.code,'TEACHER','Registration must ignore a forged internal student code.');
  assert.equal((await state(selfClient)).student.id,selfId,'Registration must establish a student session cookie.');
  const studentCookie=signup.response.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ');
  const teacherWithStudentCookie=await state(teacherDevice({cookie:studentCookie}));
  assert.ok(teacherWithStudentCookie.user);assert.equal(teacherWithStudentCookie.isTeacher,true);
  assert.equal(teacherWithStudentCookie.student,null,'Teacher controls must ignore a real student session cookie.');assert.equal(teacherWithStudentCookie.game,null);
  const studentWithCookie=await state(device({cookie:studentCookie}));
  assert.equal(studentWithCookie.student.id,selfId);assert.equal(studentWithCookie.user,null);assert.equal(studentWithCookie.isTeacher,false,'The ordinary student API must restore the student without granting teacher controls.');
  const registeredRoster=await action(device(),{action:'roster'});assert.ok(registeredRoster.students.some(row=>row.id===selfId));
  for(const row of registeredRoster.students)assert.deepEqual(Object.keys(row).sort(),['avatar','id','name']);
  assert.ok((await state(teacher)).dashboard.students.some(row=>row.id===selfId),'Teacher dashboard must immediately show the registered student.');
  const selfTeacherDenied=await selfClient('/api/game',{action:'settings',settings:{}},{allowError:true});assert.equal(selfTeacherDenied.status,403);
  const registrationError=async(payload,status)=>{const result=await device()('/api/game',payload,{allowError:true});assert.equal(result.status,status);assert.deepEqual(Object.keys(result.data),['error']);return result;};
  await registrationError({action:'register',name:'Mismatch Learner',pin:'7529',confirmPin:'7530'},400);
  await registrationError({action:'register',name:'Letters Learner',pin:'12AB'},400);
  await registrationError({action:'register',name:'Short Learner',pin:'123'},400);
  await registrationError({action:'register',name:'Long PIN Learner',pin:'12345'},400);
  await registrationError({action:'register',name:'  NEW   learner  ',pin:'9362'},409);
  const fullWidth='New Learner'.replace(/[!-~]/g,character=>String.fromCharCode(character.charCodeAt(0)+0xfee0)).replace(/ /g,'\u3000');
  await registrationError({action:'register',name:fullWidth,pin:'9362'},409);
  const raceNames=['Concurrent Signup',' concurrent   SIGNUP '];
  const registrations=await Promise.all(raceNames.map(name=>device()('/api/game',{action:'register',name,pin:'6402'},{allowError:true})));
  assert.equal(registrations.filter(result=>result.status===200).length,1,'Concurrent duplicate sign-ups must create exactly one profile.');
  assert.equal(registrations.filter(result=>result.status===409).length,1);
  const normalizeName=name=>name.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('en-US');
  assert.equal((await state(teacher)).dashboard.students.filter(row=>normalizeName(row.name)==='concurrent signup').length,1);
  const unchanged=await state(selfClient);assert.equal(unchanged.student.id,selfId);assert.equal(unchanged.student.coins,0);assert.equal(unchanged.student.name,'New Learner');
  pass('student self-registration creates a real zero-stat student cookie and rejects forged privileges, bad PINs, and duplicate/racing names');

  t=await state(teacher);t=await action(teacher,{action:'settings',settings:{...t.classroom,allowRegistration:false}});assert.equal(t.classroom.allowRegistration,false);
  await registrationError({action:'register',name:'Closed Signup',pin:'4186'},403);
  assert.equal((await state(teacher)).dashboard.students.some(row=>row.name==='Closed Signup'),false,'A rejected closed sign-up must not insert a profile.');
  await action(selfClient,{action:'logout'});selfClient=device();selfState=await action(selfClient,{action:'login',name:'  NEW   learner ',pin:'7529'});
  assert.equal(selfState.student.id,selfId);assert.equal(selfState.classroom.allowRegistration,false,'Closing sign-up must not block existing student login.');
  t=await action(teacher,{action:'settings',settings:{...t.classroom,allowRegistration:true}});
  const reopened=await action(device(),{action:'register',name:'Reopened Learner',pin:'4186'});assert.equal(reopened.student.name,'Reopened Learner');assert.equal(reopened.student.coins,0);
  const teacherDuplicate=await teacher('/api/game',{action:'saveStudent',student:{name:'  reopened   LEARNER ',pin:'4931',levelId:'mini',goal:2}},{allowError:true});
  assert.equal(teacherDuplicate.status,409,'Teacher enrollment must block normalized duplicate names too.');
  assert.equal((await state(teacher)).dashboard.students.filter(row=>row.name==='Reopened Learner').length,1);
  t=await action(teacher,{action:'saveStudent',student:{id:reopened.student.id,name:'Reopened Learner',avatar:'🦊',theme:'silver',levelId:'mini',goal:3}});
  assert.equal(t.dashboard.students.find(row=>row.id===reopened.student.id).goal,3,'Editing an existing account must preserve its identity.');
  selfState=await action(selfClient,{action:'start',levelId:'mini'});const selfSolution=solve(selfState.game);
  for(let index=0;index<selfSolution.length;index++)if(!selfState.game.puzzle[index])selfState=await action(selfClient,{action:'move',index,value:selfSolution[index],gameId:selfState.game.id,revision:selfState.game.revision});
  assert.equal(selfState.student.totalSolved,1);assert.equal(selfState.records.length,1);assert.equal(selfState.student.coins,1);assert.equal(selfState.records[0].coins,1);const savedSignup=structuredClone(selfState);
  await registrationError({action:'register',name:' new   LEARNER ',pin:'9362'},409);
  const afterCompletedDuplicate=await state(selfClient);assert.deepEqual(afterCompletedDuplicate.records,savedSignup.records);assert.equal(afterCompletedDuplicate.student.coins,savedSignup.student.coins);assert.deepEqual(afterCompletedDuplicate.student.best,savedSignup.student.best);
  await action(selfClient,{action:'logout'});
  t=await action(teacher,{action:'saveStudent',student:{id:selfId,name:'Renamed New Learner',avatar:selfState.student.avatar,theme:selfState.student.theme,levelId:selfState.student.levelId,goal:selfState.student.goal}});
  assert.equal(t.dashboard.students.find(row=>row.id===selfId).name,'Renamed New Learner');
  const reclaimed=await action(device(),{action:'register',name:'New Learner',pin:'3186'});const reclaimedId=reclaimed.student.id;
  assert.notEqual(reclaimedId,selfId,'A renamed registration must release its old name without moving the old student record.');assert.equal(reclaimed.student.coins,0);assert.deepEqual(reclaimed.records,[]);
  const renamedDevice=device(),renamed=await action(renamedDevice,{action:'login',name:'Renamed New Learner',pin:'7529'});
  assert.equal(renamed.student.name,'Renamed New Learner');assert.equal(renamed.student.id,selfId);assert.deepEqual(renamed.records,savedSignup.records);assert.equal(renamed.student.coins,savedSignup.student.coins);assert.deepEqual(renamed.student.best,savedSignup.student.best);
  pass('teacher can close/reopen sign-up; registered student records survive name/PIN login and teacher renaming without overwriting a reused name');

  const avatarClient=device();let buddy=await action(avatarClient,{action:'register',name:'Avatar Learner',pin:'0507',blockAvatar:{level:5,owned:['crown']},awards:['perfect']});
  assert.deepEqual(buddy.student.blockAvatar,{color:'ocean',face:'smile',accessory:'none',level:1,owned:[]},'Registration must ignore forged avatar levels and inventory.');
  assert.deepEqual(buddy.student.awards,[]);
  for(const payload of [{action:'avatarBuy',itemId:'cap'},{action:'avatarBuy',itemId:'beanie'},{action:'avatarUpgrade'},{action:'avatar',color:'ocean',face:'smile',accessory:'crown'}]){
    const rejected=await avatarClient('/api/game',payload,{allowError:true});assert.ok(rejected.status>=400,'Unearned upgrades and locked accessories must be rejected.');
  }
  assert.equal((await state(avatarClient)).student.coins,0);
  async function finishBuddy(withMistake=false){
    buddy=await action(avatarClient,{action:'start',levelId:'easy'});const solution=solve(buddy.game);
    if(withMistake){const index=buddy.game.puzzle.findIndex(value=>!value);buddy=await action(avatarClient,{action:'move',index,value:solution[index]%buddy.game.size+1});}
    for(let index=0;index<solution.length;index++)if(!buddy.game.puzzle[index])buddy=await action(avatarClient,{action:'move',index,value:solution[index],gameId:buddy.game.id,revision:buddy.game.revision});
    assert.equal(buddy.game.status,'completed');
  }
  await finishBuddy();assert.deepEqual(buddy.student.awards,['first-puzzle','perfect']);
  await finishBuddy();await finishBuddy();assert.equal(buddy.student.coins,135,'Three clean Explorer puzzles must retain their 45-coin rewards.');
  buddy=await action(avatarClient,{action:'avatarUpgrade'});assert.equal(buddy.student.blockAvatar.level,2);assert.equal(buddy.student.coins,105);
  const purchases=await Promise.all([1,2].map(()=>avatarClient('/api/game',{action:'avatarBuy',itemId:'cap'},{allowError:true})));
  assert.equal(purchases.filter(result=>result.status===200).length,1,'Concurrent duplicate purchases must debit coins only once.');
  buddy=await action(avatarClient,{action:'avatar',color:'violet',face:'cool',accessory:'cap',level:5,owned:['wings'],coins:9999});
  assert.deepEqual(buddy.student.blockAvatar,{color:'violet',face:'cool',accessory:'cap',level:2,owned:['cap']});assert.equal(buddy.student.coins,5,'The cap must cost 100 coins, with only one debit for concurrent duplicate purchases.');
  const unaffordableUpgrade=await avatarClient('/api/game',{action:'avatarUpgrade'},{allowError:true});assert.equal(unaffordableUpgrade.status,409);assert.equal((await state(avatarClient)).student.coins,5);
  await finishBuddy();assert.ok(buddy.student.awards.includes('streak-three'));
  await finishBuddy();await finishBuddy();assert.equal(buddy.student.coins,140);
  const expensiveBeanie=await avatarClient('/api/game',{action:'avatarBuy',itemId:'beanie'},{allowError:true});assert.equal(expensiveBeanie.status,409,'A new 150-coin accessory must stay locked below its price.');assert.equal((await state(avatarClient)).student.coins,140);
  await finishBuddy();buddy=await action(avatarClient,{action:'avatarBuy',itemId:'beanie'});assert.equal(buddy.student.coins,35);assert.deepEqual(buddy.student.blockAvatar.owned,['cap','beanie']);
  buddy=await action(avatarClient,{action:'avatar',color:'violet',face:'cool',accessory:'beanie'});assert.equal(buddy.student.blockAvatar.accessory,'beanie');
  await finishBuddy(true);assert.equal(buddy.student.streak,0);assert.ok(buddy.student.awards.includes('streak-three'),'Earned awards must remain after the streak ends.');
  const savedBuddy=structuredClone(buddy);
  pass('higher accessory prices, new accessory purchases, block upgrades, customization, and permanent awards enforce saved balances and ownership');

  t=await action(teacher,{action:'saveStudent',student:{name:'EXE Student',pin,levelId:'mini',goal:2}});
  const student=t.dashboard.students.find(s=>s.name==='EXE Student');assert.ok(student);
  assert.equal(student.avatar,'🐬');assert.equal(student.theme,'navy','Real student profiles must default to the DeGolyer blue theme.');
  await registrationError({action:'register',name:' exe   STUDENT ',pin:'9362'},409);
  const first=device();const roster=await action(first,{action:'roster'});
  assert.deepEqual(Object.keys(roster).sort(),['classroom','students']);assert.deepEqual(Object.keys(roster.classroom),['name']);
  assert.ok(roster.students.some(s=>s.id===student.id));
  for(const s of roster.students)assert.deepEqual(Object.keys(s).sort(),['avatar','id','name']);
  assert.deepEqual(await action(device(),{action:'roster',classCode:'RETIRED-IGNORED-CODE'}),roster,'Legacy class-code input must not select a different classroom.');
  let s=await action(first,{action:'login',name:'EXE Student',pin});
  s=await action(first,{action:'start',levelId:'mini'});const solution=solve(s.game);
  for(let i=0;i<solution.length;i++)if(!s.game.puzzle[i])s=await action(first,{action:'move',index:i,value:solution[i],gameId:s.game.id,revision:s.game.revision});
  assert.equal(s.student.totalSolved,1);assert.equal(s.records.length,1);assert.equal(s.student.coins,1,'A perfect Mini must award exactly one coin.');assert.equal(s.records[0].coins,1,'The stored Mini completion record must also report one coin.');assert.equal(typeof s.student.best.mini,'number');
  s=await action(first,{action:'heartbeat'});assert.equal(s.student.coins,1);assert.equal(s.records.length,1,'Revisiting a completed Mini must not duplicate its reward.');
  t=await state(teacher);t=await action(teacher,{action:'settings',settings:{...t.classroom,prizes:[{id:'saved-prize',name:'Classroom celebration',description:'A teacher reward.',cost:1,icon:'star'}]}});
  s=await action(first,{action:'redemption',prizeId:'saved-prize'});assert.equal(s.redemptions.length,1);assert.equal(s.redemptions[0].status,'pending');assert.equal(s.student.coins,0,'Redeeming the earned Mini coin must debit exactly one coin.');
  s=await action(first,{action:'start',levelId:'mini'});const empties=s.game.puzzle.flatMap((v,i)=>v?[]:[i]),nextSolution=solve(s.game);
  s=await action(first,{action:'move',index:empties[0],value:nextSolution[empties[0]]});
  s=await action(first,{action:'note',index:empties[1],value:nextSolution[empties[1]]});
  s=await action(first,{action:'profile',avatar:'🦊',theme:'teal'});s=await action(first,{action:'pause'});
  const saved=structuredClone(s);
  assert.ok(existsSync(path.join(dataDir,'classroom.sqlite')),'Database must be stored beside the copied executable, not in its current working directory.');
  pass('selected name/PIN saves board, notes, best score, coins, profile, and completion record to local SQLite');

  await stop();
  const legacyDatabase=new DatabaseSync(path.join(dataDir,'classroom.sqlite'));
  try{const row=legacyDatabase.prepare('SELECT data FROM classrooms WHERE id=?').get('main');const legacyClassroom=JSON.parse(row.data);legacyClassroom.code='OLD-CLASS-CODE';delete legacyClassroom.allowRegistration;legacyDatabase.prepare('UPDATE classrooms SET data=? WHERE id=?').run(JSON.stringify(legacyClassroom),'main');legacyDatabase.prepare('INSERT OR REPLACE INTO _standalone_auth(id,password_hash) VALUES(1,?)').run('retired-fixture-password-hash');}finally{legacyDatabase.close();}
  await start(cwdB);
  assert.ok(!logs.includes('/teacher?setup='),'Restart must not introduce a teacher password or setup-code step.');
  const teacherAgain=teacherDevice();t=await openTeacher(teacherAgain);
  assert.ok(t.user,'An existing classroom with a retired teacher password must still open the dashboard directly.');
  assert.ok(t.isTeacher);assert.equal(t.classroom.name,'EXE Persistence Test');assert.equal('code' in t.classroom,false);
  assert.equal(t.classroom.allowRegistration,true,'Legacy classrooms with no sign-up flag must default to allowing name registration.');
  const fresh=device();await action(fresh,{action:'roster'});
  const restored=await action(fresh,{action:'login',name:' exe   STUDENT ',pin});
  assert.deepEqual(restored.game,saved.game,'Restart + new device must restore exact paused puzzle, notes, timer, and counters.');
  assert.deepEqual(restored.records,saved.records);
  assert.deepEqual(restored.redemptions,saved.redemptions,'Prize history must survive a server restart.');
  for(const field of ['id','coins','totalSolved','streak','best','avatar','theme','goal','levelId','blockAvatar','awards'])assert.deepEqual(restored.student[field],saved.student[field],'Restart must retain '+field);
  const restoredBuddy=await action(device(),{action:'login',name:'Avatar Learner',pin:'0507'});
  for(const field of ['id','coins','totalSolved','best','blockAvatar','awards'])assert.deepEqual(restoredBuddy.student[field],savedBuddy.student[field],'Restart must retain avatar student '+field);
  assert.deepEqual(restoredBuddy.records,savedBuddy.records);
  assert.equal(t.dashboard.students.find(row=>row.id===student.id).totalSolved,1);
  const badPinDevice=device(),badPin=await badPinDevice('/api/game',{action:'login',name:'EXE Student',pin:'0000'},{allowError:true});assert.equal(badPin.status,401);assert.deepEqual(Object.keys(badPin.data).sort(),['code','error']);assert.equal(badPin.data.code,'PIN_INCORRECT');
  const rejectedState=await state(badPinDevice);assert.equal(rejectedState.student,null);assert.equal(rejectedState.game,null);assert.deepEqual(rejectedState.records,[]);
  const restoredSignup=await action(device(),{action:'login',name:'Renamed New Learner',pin:'7529'});
  assert.equal(restoredSignup.student.name,'Renamed New Learner');assert.deepEqual(restoredSignup.records,savedSignup.records);assert.equal(restoredSignup.student.coins,savedSignup.student.coins);assert.deepEqual(restoredSignup.student.best,savedSignup.student.best);
  const restoredReused=await action(device(),{action:'login',name:'New Learner',pin:'3186'});assert.equal(restoredReused.student.id,reclaimedId);assert.equal(restoredReused.student.name,'New Learner');assert.equal(restoredReused.student.coins,0);assert.deepEqual(restoredReused.records,[]);
  const legacySignup=await action(device(),{action:'register',name:'Legacy Enabled Learner',pin:'5317'});assert.equal(legacySignup.student.name,'Legacy Enabled Learner');assert.equal(legacySignup.student.coins,0);
  pass('restart from another folder preserves legacy classroom data and exact student records while hiding retired class codes');

  await stop();const defaultServer=await start(cwdB,false);
  const lan=Object.values(os.networkInterfaces()).flat().find(v=>v&&v.family==='IPv4'&&!v.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v.address));
  if(lan){const info=await (await fetch(origin+'/api/server-info')).json();const advertised=new URL(info.shareOrigin);assert.notEqual(advertised.hostname,'127.0.0.1','Share classroom must advertise a network address, not the teacher’s loopback URL.');assert.equal(advertised.port,String(defaultServer.port));const lanOrigin='http://'+lan.address+':'+defaultServer.port;const health=await fetch(lanOrigin+'/health',{signal:AbortSignal.timeout(3000)});assert.equal(health.status,200);const teacherLan=await fetch(lanOrigin+'/teacher',{redirect:'manual',signal:AbortSignal.timeout(3000)});assert.equal(teacherLan.status,403);const teacherApiLan=await fetch(lanOrigin+'/teacher/api/game',{signal:AbortSignal.timeout(3000)});assert.equal(teacherApiLan.status,403,'Teacher controls must stay inaccessible over the school network.');pass('default binding and advertised share URL use LAN while teacher page and controls stay local');}
  else console.log('SKIP LAN address probe: no private IPv4 interface is present. Default server health still passed.');
  console.log('Standalone EXE smoke test passed. Local fixtures: '+fixture);
}finally{await stop();}
