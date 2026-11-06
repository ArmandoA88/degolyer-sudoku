/**
 * Windows tunnel integration, using a tiny local fake cloudflared executable.
 * No public tunnel, Cloudflare request, real account, or real classroom is used.
 * Run after rebuilding: node standalone/tests/tunnel-smoke.mjs [server.exe]
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

assert.equal(process.platform,'win32','This test exercises the Windows executable.');
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const originalExe=path.resolve(process.argv[2]||path.join(project,'..','DeGolyer-Sudoku-Server.exe'));
assert.ok(existsSync(originalExe),'Build the standalone EXE before running this check.');
const outputs=path.join(project,'outputs');mkdirSync(outputs,{recursive:true});
const fixture=mkdtempSync(path.join(outputs,'tunnel smoke '));
const copiedExe=path.join(fixture,'Sudoku Server.exe');copyFileSync(originalExe,copiedExe);
const fakeExe=path.join(fixture,'cloudflared fixture.exe');
const compiler=path.join(process.env.SystemRoot||'C:/Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
assert.ok(existsSync(compiler),'The Windows .NET Framework C# compiler is needed for this local test fixture.');
const compilation=spawnSync(compiler,['/nologo','/target:exe','/out:'+fakeExe,path.join(project,'standalone','tests','fixtures','fake-cloudflared.cs')],{windowsHide:true,encoding:'utf8',shell:false});
assert.equal(compilation.status,0,'Could not build fake cloudflared: '+compilation.stdout+compilation.stderr);
const publicOrigin='https://sudoku-fixture.trycloudflare.com';
const publicHost=new URL(publicOrigin).host;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pass=message=>console.log('PASS '+message);
let child,logs='',localOrigin,recordFile,fakePid;

async function until(label,operation,timeout=15000){
  const deadline=Date.now()+timeout;let lastError;
  while(Date.now()<deadline){
    try{const result=await operation();if(result)return result;}catch(error){lastError=error;}
    await sleep(50);
  }
  throw new Error(label+' timed out'+(lastError?': '+lastError.message:'')+'\n'+logs.slice(-2500));
}
async function freePort(){
  const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function start(cloudflared,name,explicitTunnel=true){
  const port=await freePort();localOrigin='http://127.0.0.1:'+port;logs='';fakePid=undefined;
  recordFile=path.join(fixture,name+' cloudflared-record.txt');
  const env={...process.env,SUDOKU_TUNNEL_FIXTURE_OUTPUT:recordFile};delete env.NODE_OPTIONS;
  child=spawn(copiedExe,['--port',String(port),'--host','127.0.0.1','--data-dir',path.join(fixture,'Classroom data'),'--no-open',...(explicitTunnel?['--tunnel']:[]),'--cloudflared',cloudflared],{cwd:fixture,env,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
  child.stdout.on('data',chunk=>logs+=chunk.toString());child.stderr.on('data',chunk=>logs+=chunk.toString());
  let spawnError;child.once('error',error=>spawnError=error);
  await until('Local server health',async()=>{
    if(spawnError)throw spawnError;if(child.exitCode!==null)throw new Error('Server exited '+child.exitCode);
    const response=await fetch(localOrigin+'/health',{signal:AbortSignal.timeout(500)});return response.ok;
  });
}
async function stop(){
  if(child&&child.exitCode===null){const current=child;current.kill('SIGTERM');await Promise.race([new Promise(resolve=>current.once('exit',resolve)),sleep(3000)]);if(current.exitCode===null)current.kill('SIGKILL');}
  child=undefined;
  if(!fakePid&&recordFile&&existsSync(recordFile))fakePid=Number(readFileSync(recordFile,'utf8').split(/\r?\n/,1)[0]);
  if(fakePid){try{process.kill(fakePid);}catch{}}
  fakePid=undefined;
}
function request(origin,urlPath='/api/game',payload,options={}){
  const url=new URL(origin);
  const headers={origin:options.public?publicOrigin:origin,...options.headers};
  if(options.public)headers.host=options.host??publicHost;
  if(options.cookie)headers.cookie=options.cookie;
  const body=options.form?new URLSearchParams(options.form).toString():payload===undefined?undefined:JSON.stringify(payload);
  if(body!==undefined){headers['content-type']=options.form?'application/x-www-form-urlencoded':'application/json';headers['content-length']=Buffer.byteLength(body);}
  return new Promise((resolve,reject)=>{
    const call=http.request({hostname:url.hostname,port:url.port,method:body===undefined?'GET':'POST',path:urlPath,headers,timeout:5000},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{
        const raw=Buffer.concat(chunks).toString('utf8');let data;try{data=JSON.parse(raw);}catch{data={html:raw};}
        resolve({status:response.statusCode,headers:response.headers,raw,data});
      });
    });
    call.once('error',reject);call.once('timeout',()=>call.destroy(new Error('Request timed out')));call.end(body);
  });
}
function cookiePairs(result){return (result.headers['set-cookie']??[]).map(value=>value.split(';',1)[0]).join('; ');}
try{
  await start(fakeExe,'working',false);
  await until('Fake cloudflared launch record',()=>existsSync(recordFile));
  const record=readFileSync(recordFile,'utf8').trim().split(/\r?\n/);fakePid=Number(record[0]);
  assert.ok(Number.isInteger(fakePid)&&fakePid>0);
  const tunnelOrigin=record[1],ingress=new URL(tunnelOrigin);
  assert.equal(ingress.protocol,'http:');assert.equal(ingress.hostname,'127.0.0.1','Tunnel origin must bind only loopback.');
  assert.notEqual(tunnelOrigin,localOrigin,'Cloudflare must use a separate student-only listener.');
  const info=await until('Public classroom share link',async()=>{const value=await request(localOrigin,'/api/server-info');return value.data.shareOrigin===publicOrigin?value.data:null;});
  assert.equal(info.shareOrigin,publicOrigin);
  assert.equal((await request(tunnelOrigin,'/health',undefined,{public:true})).status,200);
  const tunnelInfo=await request(tunnelOrigin,'/api/server-info',undefined,{public:true});assert.equal(tunnelInfo.data.shareOrigin,publicOrigin);
  pass('the copied EXE defaults to online mode and publishes its fake tunnel HTTPS classroom link through a separate loopback origin');

  assert.equal(logs.includes('/teacher?setup='),false,'The local dashboard must not require a teacher password or setup token.');
  for(const route of ['/teacher','/teacher/']){
    const page=await request(localOrigin,route);
    assert.equal(page.status,200);assert.match(page.raw,/Sudoku Studio/);assert.doesNotMatch(page.raw,/<form\b|name=["']password["']|dg_teacher_csrf/i);
  }
  const teacherState=await request(localOrigin,'/teacher/api/game');assert.equal(teacherState.status,200);assert.ok(teacherState.data.user);assert.equal(teacherState.data.isTeacher,false);
  const classroom=await request(localOrigin,'/teacher/api/game',{action:'setup',name:'Tunnel fixture classroom',teacherName:'Fixture Teacher'});
  assert.equal(classroom.status,200);assert.equal(classroom.data.isTeacher,true);
  const teacherCookie='dg_teacher='+'a'.repeat(48);
  const spoofHeaders={'oai-authenticated-user-id':'standalone-teacher','oai-authenticated-user-email':'local-teacher@degolyer.invalid','x-forwarded-for':'127.0.0.1','x-forwarded-host':'localhost','x-forwarded-proto':'http','cf-connecting-ip':'203.0.113.11'};
  for(const route of ['/teacher','/teacher/','/teacher/api/game','/teacher/controls','/signin-with-chatgpt','/signout-with-chatgpt','/teacher?setup=retired-token']){
    const denied=await request(tunnelOrigin,route,undefined,{public:true,cookie:teacherCookie,headers:spoofHeaders});assert.equal(denied.status,403,route+' must stay inaccessible through the tunnel.');
  }
  const oldPublicForm=await request(tunnelOrigin,'/teacher',undefined,{public:true,form:{mode:'setup',password:'Retired-ignored-fixture',csrf:'retired-token'},cookie:teacherCookie,headers:spoofHeaders});
  assert.equal(oldPublicForm.status,403,'The retired password-form redirect must never open teacher access through a tunnel.');
  const publicState=await request(tunnelOrigin,'/api/game',undefined,{public:true,cookie:teacherCookie,headers:spoofHeaders});
  assert.equal(publicState.status,200);assert.equal(publicState.data.user,null);assert.equal(publicState.data.isTeacher,false);assert.equal(publicState.data.dashboard,undefined);
  const forbidden=await request(tunnelOrigin,'/api/game',{action:'settings',settings:classroom.data.classroom},{public:true,cookie:teacherCookie,headers:spoofHeaders});assert.equal(forbidden.status,403);
  const protectedApi=await request(tunnelOrigin,'/teacher/api/game',{action:'settings',settings:classroom.data.classroom},{public:true,cookie:teacherCookie,headers:spoofHeaders});assert.equal(protectedApi.status,403,'The dedicated teacher API must remain local-only for writes as well as reads.');
  const roster=await request(tunnelOrigin,'/api/game',{action:'roster'},{public:true});assert.equal(roster.status,403,'Public traffic must not list student names.');
  pass('local teacher controls open directly without login; public requests cannot use their API, retired cookies, identity headers, or the student roster');

  for(const host of ['localhost','127.0.0.1','unrelated.example.invalid']){
    const denied=await request(tunnelOrigin,'/health',undefined,{public:true,host});assert.equal(denied.status,403,'Tunnel ingress must reject Host '+host);
  }
  for(const target of ['http://127.0.0.1/teacher','//localhost/teacher']){
    const denied=await request(tunnelOrigin,target,undefined,{public:true});assert.ok(denied.status>=400,'Absolute and network-path targets must be rejected.');
  }
  const badOrigin=await request(tunnelOrigin,'/api/game',{action:'register',name:'Untrusted Origin',pin:'2739'},{public:true,headers:{origin:'https://unrelated.example.invalid'}});assert.equal(badOrigin.status,403);
  const signedUp=await request(tunnelOrigin,'/api/game',{action:'register',name:'Online Learner',pin:'0027'},{public:true});
  assert.equal(signedUp.status,200,signedUp.raw);assert.equal(signedUp.data.student.name,'Online Learner');
  const sessionCookie=signedUp.headers['set-cookie'].find(value=>value.startsWith('dg_student='));assert.match(sessionCookie,/; Secure(?:;|$)/);assert.match(sessionCookie,/HttpOnly/);
  const logout=await request(tunnelOrigin,'/api/game',{action:'logout'},{public:true,cookie:cookiePairs(signedUp)});assert.equal(logout.status,200);
  const signedIn=await request(tunnelOrigin,'/api/game',{action:'login',name:' online   LEARNER ',pin:'0027'},{public:true});
  assert.equal(signedIn.status,200,signedIn.raw);assert.equal(signedIn.data.student.id,signedUp.data.student.id);
  const ordinary=await request(localOrigin,'/api/game',undefined,{headers:spoofHeaders});assert.equal(ordinary.data.isTeacher,false);assert.equal(ordinary.data.user,null);
  for(const route of ['/SudokuData/classroom.sqlite','/package.json','/standalone/server.ts'])assert.ok((await request(tunnelOrigin,route,undefined,{public:true})).status>=400);
  pass('tunnel Host and HTTPS Origin checks protect secure name/PIN sessions while source and database files stay private');

  const studentsBefore=(await request(localOrigin,'/teacher/api/game')).data.dashboard.students.length;
  const limitedHeaders={'cf-connecting-ip':'203.0.113.44'};
  for(let attempt=1;attempt<=120;attempt++){
    const rejected=await request(tunnelOrigin,'/api/game',{action:'login',name:'Unknown Network '+attempt,pin:'0027'},{public:true,headers:limitedHeaders});
    assert.equal(rejected.status,401,'Unique unknown-name attempt '+attempt+' should reach the name/PIN check before the network limit.');
    assert.equal(rejected.data.code,'ACCOUNT_NOT_FOUND');
  }
  const throttled=await request(tunnelOrigin,'/api/game',{action:'login',name:'Unknown Network 121',pin:'0027'},{public:true,headers:limitedHeaders});
  assert.equal(throttled.status,429,'The 121st public authentication attempt from one network must be throttled.');assert.match(throttled.data.error,/from this network/i);
  const otherNetwork=await request(tunnelOrigin,'/api/game',{action:'login',name:'Online Learner',pin:'0027'},{public:true,headers:{'cf-connecting-ip':'203.0.113.45'}});
  assert.equal(otherNetwork.status,200,otherNetwork.raw);assert.equal(otherNetwork.data.student.id,signedUp.data.student.id);
  const studentsAfter=(await request(localOrigin,'/teacher/api/game')).data.dashboard.students;
  assert.equal(studentsAfter.length,studentsBefore,'Failed and throttled public logins must not create student profiles.');
  const forgedLanHeaders={...spoofHeaders,...limitedHeaders,'x-sudoku-public-ingress':'1'};
  const localUnknown=await request(localOrigin,'/api/game',{action:'login',name:'Local Unknown Learner',pin:'0027'},{headers:forgedLanHeaders});
  assert.equal(localUnknown.status,401,'Untrusted LAN headers must not impersonate an exhausted public network.');assert.equal(localUnknown.data.code,'ACCOUNT_NOT_FOUND');
  const localRoster=await request(localOrigin,'/api/game',{action:'roster'},{headers:forgedLanHeaders});
  assert.equal(localRoster.status,200,'The LAN roster must remain available when the public marker is forged by a client.');assert.ok(localRoster.data.students.some(student=>student.id===signedUp.data.student.id));
  const localIdentity=await request(localOrigin,'/api/game',undefined,{headers:forgedLanHeaders});assert.equal(localIdentity.data.user,null);assert.equal(localIdentity.data.isTeacher,false);
  pass('public authentication is limited per trusted client IP without inserting profiles or trusting spoofed LAN headers');

  writeFileSync(recordFile+'.stop','stop');
  await until('Public share-link fallback after cloudflared exit',async()=>{const info=await request(localOrigin,'/api/server-info');return info.data.shareOrigin!==publicOrigin&&info.data.tunnel?.state==='failed';});
  assert.equal((await request(localOrigin,'/health')).status,200,'Local classroom must keep running after cloudflared exits.');
  pass('cloudflared exit clears the public share link while local network play remains available');
  await stop();

  await start(path.join(fixture,'missing cloudflared.exe'),'missing');
  const fallback=await until('Missing-cloudflared failure state',async()=>{const value=await request(localOrigin,'/api/server-info');return value.data.tunnel?.state==='failed'?value:null;});
  assert.notEqual(fallback.data.shareOrigin,publicOrigin);assert.ok(fallback.data.tunnel.error);
  assert.equal((await request(localOrigin,'/health')).status,200);
  pass('an unavailable cloudflared executable leaves a working local classroom instead of a false public link');
  console.log('Tunnel smoke test passed. Isolated local fixture: '+fixture);
}finally{await stop();}
