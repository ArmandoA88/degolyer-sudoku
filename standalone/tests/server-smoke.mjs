/**
 * Standalone Windows EXE integration test. Creates only isolated local fixtures.
 * Run: node standalone/tests/server-smoke.mjs [absolute-path-to-server.exe]
 * The copied EXE is run without Node on PATH, from folders containing spaces.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {closeSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,openSync,readSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
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
const cwdA=path.join(fixture,'First unrelated working folder'),cwdB=path.join(fixture,'Second unrelated working folder');
mkdirSync(cwdA);mkdirSync(cwdB);
const dataDir=path.join(portableDir,'SudokuData');
const password='LocalFixturePass-8246',pin='8246';
const sampleContent=/Maya R\.|Leo M\.|Sofia G\.|Ethan J\.|Isabella A\.|Noah T\.|Demo classroom|Example scores stay on this device|demoSolution|demoHistory/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pass=text=>console.log('PASS '+text);
let child,logs='',origin;

async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function start(cwd,explicitLoopback=true){
  const port=await freePort();origin='http://127.0.0.1:'+port;logs='';
  const env={...process.env,PATH:path.join(process.env.SystemRoot||'C:/Windows','System32')};delete env.NODE_OPTIONS;
  const args=['--port',String(port),'--no-open',...(explicitLoopback?['--host','127.0.0.1']:[])];
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
function unescapeHtml(value){return value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function fields(html){
  const result={};for(const input of html.matchAll(/<input\b[^>]*>/gi)){
    const attr=name=>{const m=input[0].match(new RegExp('\\b'+name+'=["\\\']([^"\\\']*)["\\\']','i'));return m?unescapeHtml(m[1]):''};
    const name=attr('name');if(!name)continue;result[name]=attr('type').toLowerCase()==='password'?password:attr('value');
  }return result;
}
async function teacherSignIn(client,setupUrl){
  const page=await client(setupUrl?new URL(setupUrl).pathname+new URL(setupUrl).search:'/teacher');
  assert.match(page.raw,/<form\b/i,'Teacher sign-in must display a real form.');
  const form=fields(page.raw);assert.ok(form.csrf,'Teacher form must include a CSRF value.');
  const badCsrf=await client('/teacher',undefined,{form:{...form,csrf:'invalid-csrf'},allowError:true});
  assert.equal(badCsrf.status,403,'Teacher form must reject an incorrect CSRF token.');
  const badOrigin=await client('/teacher',undefined,{form,headers:{origin:'http://untrusted.invalid'},allowError:true});
  assert.equal(badOrigin.status,403,'Teacher form must reject an unrelated Origin.');
  const result=await client('/teacher',undefined,{form,allowError:true});
  assert.ok([302,303].includes(result.status),'Teacher authentication must redirect after a successful form submission: '+result.raw.slice(0,400));
  const current=await state(client);assert.ok(current.user,'Local teacher authentication must establish identity.');return current;
}
function solve(game){
  const board=[...game.puzzle],{size,boxRows,boxCols}=game;
  function visit(){const index=board.indexOf(0);if(index<0)return true;const row=Math.floor(index/size),col=index%size;
    for(let value=1;value<=size;value++){let valid=true;for(let i=0;i<size;i++)if(board[row*size+i]===value||board[i*size+col]===value)valid=false;
      for(let r=Math.floor(row/boxRows)*boxRows;r<Math.floor(row/boxRows)*boxRows+boxRows;r++)for(let c=Math.floor(col/boxCols)*boxCols;c<Math.floor(col/boxCols)*boxCols+boxCols;c++)if(board[r*size+c]===value)valid=false;
      if(!valid)continue;board[index]=value;if(visit())return true;}board[index]=0;return false;}
  assert.ok(visit(),'Generated Mini puzzle must have a solution.');return board;
}

try{
  await start(cwdA);
  let setupUrl;for(let i=0;i<20&&!setupUrl;i++){setupUrl=logs.match(/http:\/\/127\.0\.0\.1:\d+\/teacher\?setup=[a-f0-9]+/i)?.[0];if(!setupUrl)await sleep(50);}
  assert.ok(setupUrl,'First run must print a local teacher setup link.');
  const anonymous=device(),spoofed=device({'oai-authenticated-user-id':'standalone-teacher','oai-authenticated-user-email':'local-teacher@degolyer.invalid'});
  const before=await state(spoofed);assert.equal(before.user,null);assert.equal(before.isTeacher,false);
  assert.equal(before.classroom,null,'A fresh server must start without a fabricated classroom.');
  assert.equal(before.student,null);assert.equal(before.game,null);
  for(const key of ['records','leaderboard','redemptions'])assert.deepEqual(before[key],[],'Fresh '+key+' must be empty.');
  assert.equal(before.dashboard,undefined,'A fresh server must not contain a fake teacher dashboard.');
  assert.equal(sampleContent.test(JSON.stringify(before)),false,'Fresh server state must not contain sample records.');
  pass('fresh server starts with an empty classroom, roster, game, records, and rewards');
  const teacher=device();let t=await teacherSignIn(teacher,setupUrl);
  t=await action(teacher,{action:'setup',name:'EXE Persistence Test',teacherName:'Local Teacher'});
  assert.ok(t.isTeacher&&t.classroom);const classCode=t.classroom.code;
  assert.deepEqual(t.classroom.prizes,[],'A newly configured classroom must not contain sample rewards.');
  const denied=await anonymous('/api/game',{action:'saveStudent',student:{}},{allowError:true});assert.equal(denied.status,403);
  const parallel=await Promise.all(Array.from({length:6},(_,i)=>state(i%2?teacher:spoofed)));
  parallel.forEach((value,i)=>assert.equal(value.isTeacher,!!(i%2),'Parallel requests must retain separate teacher identities.'));
  pass('copied EXE starts without Node on PATH; teacher setup, CSRF, and untrusted identity-header isolation');

  const page=await anonymous('/');assert.match(page.raw,/Sudoku Studio/);assert.equal(sampleContent.test(page.raw),false,'Student landing page must not contain sample profiles.');
  const assetPaths=[...page.raw.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(m=>m[1]);
  assert.ok(assetPaths.some(p=>p.endsWith('.js')),'Standalone HTML must reference an embedded JavaScript client.');
  for(const asset of assetPaths){assert.ok(asset.startsWith('/'),'Client assets must be local, not CDN URLs.');const r=await anonymous(asset);assert.equal(r.status,200);assert.equal(r.response.headers.get('cache-control'),'no-cache','Fixed asset URLs must revalidate after an EXE upgrade.');assert.ok(r.raw.length>100);assert.equal(sampleContent.test(r.raw),false,'Embedded student assets must not include sample profiles, fake scores, or demo state.');}
  for(const blocked of ['/SudokuData/classroom.sqlite','/package.json','/.env','/app/api/game/route.ts','/..%2fSudokuData%2fclassroom.sqlite','/%2e%2e%2fpackage.json']){
    const result=await anonymous(blocked,undefined,{allowError:true});assert.ok(result.status>=400,blocked+' must not serve internal files.');
  }
  pass('embedded game/CSS/JS are served locally while data, source, and traversal paths are blocked');

  t=await action(teacher,{action:'saveStudent',student:{name:'EXE Student',code:'EXE-STUDENT',pin,levelId:'mini',goal:2}});
  const student=t.dashboard.students.find(s=>s.code==='EXE-STUDENT');assert.ok(student);
  assert.equal(student.avatar,'🐬');assert.equal(student.theme,'navy','Real student profiles must default to the DeGolyer blue theme.');
  const first=device();const roster=await action(first,{action:'roster',classCode});
  assert.ok(roster.students.some(s=>s.id===student.id));
  for(const s of roster.students)assert.deepEqual(Object.keys(s).sort(),['avatar','id','name']);
  let s=await action(first,{action:'login',classCode,studentId:student.id,pin});
  s=await action(first,{action:'start',levelId:'mini'});const solution=solve(s.game);
  for(let i=0;i<solution.length;i++)if(!s.game.puzzle[i])s=await action(first,{action:'move',index:i,value:solution[i],gameId:s.game.id,revision:s.game.revision});
  assert.equal(s.student.totalSolved,1);assert.equal(s.records.length,1);assert.ok(s.student.coins>0);assert.equal(typeof s.student.best.mini,'number');
  s=await action(first,{action:'start',levelId:'mini'});const empties=s.game.puzzle.flatMap((v,i)=>v?[]:[i]),nextSolution=solve(s.game);
  s=await action(first,{action:'move',index:empties[0],value:nextSolution[empties[0]]});
  s=await action(first,{action:'note',index:empties[1],value:nextSolution[empties[1]]});
  s=await action(first,{action:'profile',avatar:'🦊',theme:'teal'});s=await action(first,{action:'pause'});
  const saved=structuredClone(s);
  assert.ok(existsSync(path.join(dataDir,'classroom.sqlite')),'Database must be stored beside the copied executable, not in its current working directory.');
  pass('selected name/PIN saves board, notes, best score, coins, profile, and completion record to local SQLite');

  await stop();await start(cwdB);
  assert.ok(!logs.includes('/teacher?setup='),'Restart must retain the configured teacher password.');
  const teacherAgain=device();t=await teacherSignIn(teacherAgain);
  assert.ok(t.isTeacher);assert.equal(t.classroom.code,classCode);
  const fresh=device();await action(fresh,{action:'roster',classCode});
  const restored=await action(fresh,{action:'login',classCode,studentId:student.id,pin});
  assert.deepEqual(restored.game,saved.game,'Restart + new device must restore exact paused puzzle, notes, timer, and counters.');
  assert.deepEqual(restored.records,saved.records);
  for(const field of ['id','coins','totalSolved','streak','best','avatar','theme','goal','levelId'])assert.deepEqual(restored.student[field],saved.student[field],'Restart must retain '+field);
  assert.equal(t.dashboard.students.find(row=>row.id===student.id).totalSolved,1);
  const badPin=await device()('/api/game',{action:'login',classCode,studentId:student.id,pin:'0000'},{allowError:true});assert.equal(badPin.status,401);assert.deepEqual(Object.keys(badPin.data),['error']);
  pass('same EXE restarted from a different folder restores teacher account and exact student records in fresh sessions');

  await stop();const defaultServer=await start(cwdB,false);
  const lan=Object.values(os.networkInterfaces()).flat().find(v=>v&&v.family==='IPv4'&&!v.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v.address));
  if(lan){const info=await (await fetch(origin+'/api/server-info')).json();const advertised=new URL(info.shareOrigin);assert.notEqual(advertised.hostname,'127.0.0.1','Share classroom must advertise a network address, not the teacher’s loopback URL.');assert.equal(advertised.port,String(defaultServer.port));const lanOrigin='http://'+lan.address+':'+defaultServer.port;const health=await fetch(lanOrigin+'/health',{signal:AbortSignal.timeout(3000)});assert.equal(health.status,200);const teacherLan=await fetch(lanOrigin+'/teacher',{redirect:'manual',signal:AbortSignal.timeout(3000)});assert.equal(teacherLan.status,403);pass('default binding and advertised share URL use LAN while teacher administration stays local');}
  else console.log('SKIP LAN address probe: no private IPv4 interface is present. Default server health still passed.');
  console.log('Standalone EXE smoke test passed. Local fixtures: '+fixture);
}finally{await stop();}
