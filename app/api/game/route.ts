import { env } from 'cloudflare:workers';
import { getChatGPTUser, type ChatGPTUser } from '../../chatgpt-auth';
import { LEVELS } from '../../../lib/sudoku';
import { newGame, editGame, publicGame, earnedCoins, type StoredGame } from '../../../lib/server-game';
import type { AppState, Classroom, Student, Game, ScoreRecord, Redemption, Activity, Prize } from '../../../lib/types';

export const dynamic='force-dynamic';
type Row=Record<string,any>;
class ApiError extends Error {constructor(message:string,public status=400){super(message);}}
const now=()=>Date.now();
const json=(data:unknown,status=200,cookie?:string)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
const db=()=>{if(!env.DB)throw new ApiError('Shared classroom storage is unavailable. Please try again.',503);return env.DB;};
const sql=(query:string,...values:unknown[])=>db().prepare(query).bind(...values);
const one=async(query:string,...values:unknown[])=>await sql(query,...values).first<Row>();
const all=async(query:string,...values:unknown[])=>((await sql(query,...values).all<Row>()).results??[]);
const parse=<T,>(value:string):T=>JSON.parse(value);
function text(value:unknown,label:string,max=80,min=1){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new ApiError(`${label} must be ${min}–${max} characters.`);return value.trim();}
function int(value:unknown,label:string,min:number,max:number){if(!Number.isInteger(value)||Number(value)<min||Number(value)>max)throw new ApiError(`${label} must be between ${min} and ${max}.`);return Number(value);}
function code(value:unknown,label:string){const v=text(value,label,20,2).toUpperCase();if(!/^[A-Z0-9-]+$/.test(v))throw new ApiError(`${label} can use letters, numbers, and hyphens.`);return v;}
const id=()=>crypto.randomUUID();
const hex=(v:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(v instanceof Uint8Array?v.buffer as ArrayBuffer:v)).map(n=>n.toString(16).padStart(2,'0')).join('');
async function hash(value:string){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function pinHash(pin:string,salt=hex(crypto.getRandomValues(new Uint8Array(16)))){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);return salt+':'+hex(bits);
}
async function verifyPin(pin:string,stored:string){const actual=await pinHash(pin,stored.split(':')[0]);let difference=actual.length^stored.length;for(let i=0;i<Math.max(actual.length,stored.length);i++)difference|=(actual.charCodeAt(i)||0)^(stored.charCodeAt(i)||0);return difference===0;}
function tokenCookie(request:Request,token:string,maxAge=28800){const secure=new URL(request.url).protocol==='https:';return `dg_student=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;}
function rawToken(request:Request){return request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('dg_student='))?.slice(11)??'';}
function student(row:Row):Student{return {id:row.id,name:row.name,code:row.code,avatar:row.avatar,theme:row.theme,levelId:row.level_id,goal:row.goal,coins:row.coins,totalSolved:row.total_solved,streak:row.streak,best:parse(row.best),lastSeen:row.last_seen,helpRequested:!!row.help_requested,teacherNote:row.teacher_note};}
async function classroomRow(){return one('SELECT * FROM classrooms WHERE id = ?', 'main');}
async function currentStudent(request:Request){const token=rawToken(request);if(!token||token.length>128)return null;return one('SELECT s.* FROM students s JOIN sessions a ON a.student_id=s.id WHERE a.hash=? AND a.expires_at>?',await hash(token),now());}
async function latestGame(studentId:string){const row=await one('SELECT * FROM games WHERE student_id=? ORDER BY updated_at DESC, rowid DESC LIMIT 1',studentId);return row?{row,game:parse<StoredGame>(row.data)}:null;}
async function log(s:Row,c:Row,message:string){const event:Activity={id:id(),studentId:s.id,studentName:s.name,text:message,at:now()};await sql('INSERT INTO activity(id,student_id,classroom_id,data,at) VALUES(?,?,?,?,?)',event.id,s.id,c.id,JSON.stringify(event),event.at).run();}

async function state(request:Request,user:ChatGPTUser|null):Promise<AppState>{
  const c=await classroomRow();const s=await currentStudent(request);const isTeacher=!!c&&user?.userId===c.owner;
  const base:AppState={user:user?{id:user.userId,name:user.displayName}:null,classroom:c?{...parse<Classroom>(c.data),code:isTeacher?c.code:''}:null,isTeacher,student:s?student(s):null,game:null,records:[],leaderboard:[],redemptions:[]};
  if(!c)return base;
  if(s&&s.classroom_id===c.id){
    const g=await latestGame(s.id);base.game=g?publicGame(g.game):null;
    base.records=(await all('SELECT data FROM records WHERE student_id=? ORDER BY completed_at DESC LIMIT 500',s.id)).map(r=>parse<ScoreRecord>(r.data));
    base.redemptions=(await all('SELECT data FROM redemptions WHERE student_id=? ORDER BY created_at DESC LIMIT 100',s.id)).map(r=>parse<Redemption>(r.data));
  }
  if((isTeacher||s)&&base.classroom?.leaderboard){base.leaderboard=(await all('SELECT id,name,total_solved,coins FROM students WHERE classroom_id=? ORDER BY total_solved DESC,coins DESC LIMIT 50',c.id)).map(r=>({studentId:r.id,name:r.name,solved:r.total_solved,coins:r.coins}));}
  if(isTeacher){
    const [students,records,redemptions,events,gameRows]=await Promise.all([
      all('SELECT * FROM students WHERE classroom_id=? ORDER BY name',c.id),all('SELECT data FROM records WHERE classroom_id=? ORDER BY completed_at DESC LIMIT 2000',c.id),all('SELECT data FROM redemptions WHERE classroom_id=? ORDER BY created_at DESC LIMIT 500',c.id),all('SELECT data FROM activity WHERE classroom_id=? ORDER BY at DESC LIMIT 300',c.id),all('SELECT g.* FROM games g JOIN students s ON s.id=g.student_id WHERE s.classroom_id=? AND g.id=(SELECT g2.id FROM games g2 WHERE g2.student_id=g.student_id ORDER BY g2.updated_at DESC,g2.rowid DESC LIMIT 1)',c.id)
    ]);
    const activity=events.map(r=>parse<Activity>(r.data));const games=new Map(gameRows.map(r=>[r.student_id,publicGame(parse<StoredGame>(r.data))]));
    base.dashboard={students:students.map(r=>({...student(r),game:games.get(r.id)??null,activity:activity.filter(a=>a.studentId===r.id).slice(0,12)})),records:records.map(r=>parse<ScoreRecord>(r.data)),redemptions:redemptions.map(r=>parse<Redemption>(r.data)),activity};
  }
  return base;
}

export async function GET(request:Request){try{return json(await state(request,await getChatGPTUser()));}catch(e){return failure(e);}}
function failure(error:unknown){if(error instanceof ApiError)return json({error:error.message},error.status);console.error('Classroom operation failed',error instanceof Error?error.message:'unknown');return json({error:'The classroom could not save this change. Please try again.'},500);}

export async function POST(request:Request){
 try {
  const origin=request.headers.get('origin');if(origin&&new URL(origin).origin!==new URL(request.url).origin)throw new ApiError('This request must come from the game.',403);
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError('This request must come from the game.',403);
  if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError('Send a JSON game action.',415);
  const raw=await request.text();if(raw.length>20000)throw new ApiError('That change is too large.',413);
  let input:Row;try{input=JSON.parse(raw);}catch{throw new ApiError('Invalid game action.');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError('Invalid game action.');
  const action=String(input.action);const user=await getChatGPTUser();let c=await classroomRow();let s=await currentStudent(request);let cookie:string|undefined;let scan:number[]|undefined;
  const teacher=()=>{if(!c||!user||c.owner!==user.userId)throw new ApiError('Teacher sign-in is required.',403);return c;};
  const learner=()=>{if(!c||!s||s.classroom_id!==c.id)throw new ApiError('Sign in with your student code and PIN.',401);return s;};

  if(action==='setup'){
    if(!user)throw new ApiError('Sign in with ChatGPT to create your classroom.',401);
    if(!c&&env.CLASSROOM_TEACHER_EMAIL&&user.email.toLowerCase()!==env.CLASSROOM_TEACHER_EMAIL.toLowerCase())throw new ApiError('Sign in with the teacher account that owns this game to set up the classroom.',403);
    const name=text(input.name,'Class name',60),teacherName=text(input.teacherName,'Teacher name',40);
    if(c){if(c.owner!==user.userId)throw new ApiError('This classroom already has a teacher.',403);}
    else {
      const classCode='DG-'+hex(crypto.getRandomValues(new Uint8Array(4))).toUpperCase();
      const prizes:Prize[]=[{id:'sticker',name:'Sticker pick',description:'Choose a sticker with your teacher.',cost:60,icon:'star'},{id:'helper',name:'Classroom helper',description:'Be a classroom helper for a day.',cost:120,icon:'sparkles'},{id:'choice',name:'Choice time',description:'A teacher-approved choice activity.',cost:200,icon:'trophy'}];
      const data:Classroom={id:'main',name,teacherName,code:classCode,powerups:true,leaderboard:false,prizes};
      await sql('INSERT OR IGNORE INTO classrooms(id,owner,code,data) VALUES(?,?,?,?)','main',user.userId,classCode,JSON.stringify(data)).run();
      c=await classroomRow();if(c?.owner!==user.userId)throw new ApiError('This classroom already has a teacher.',403);
    }
  } else if(action==='login'){
    const classCode=code(input.classCode,'Class code'),studentCode=code(input.studentCode,'Student code'),pin=text(input.pin,'PIN',12,4);
    if(!/^\d{4,12}$/.test(pin))throw new ApiError('Use your 4–12 digit PIN.');
    const key=await hash(classCode+':'+studentCode),stamp=now();
    await sql('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END',key,stamp+900000,stamp,stamp,stamp+900000).run();
    const attempt=await one('SELECT count FROM login_attempts WHERE key=?',key);if(attempt&&attempt.count>10)throw new ApiError('Too many sign-in attempts. Ask your teacher and try again in 15 minutes.',429);
    const target=c&&c.code===classCode?await one('SELECT * FROM students WHERE classroom_id=? AND code=?',c.id,studentCode):null;
    if(!target||!await verifyPin(pin,target.pin_hash))throw new ApiError('Check your class code, student code, and PIN.',401);
    const token=hex(crypto.getRandomValues(new Uint8Array(32)));
    await db().batch([sql('DELETE FROM sessions WHERE student_id=? OR expires_at<?',target.id,stamp),sql('INSERT INTO sessions(hash,student_id,expires_at) VALUES(?,?,?)',await hash(token),target.id,stamp+28800000),sql('DELETE FROM login_attempts WHERE key=?',key),sql('UPDATE students SET last_seen=? WHERE id=?',stamp,target.id)]);
    cookie=tokenCookie(request,token);s=target;
    await log(target,c!,'Signed in and ready to solve');
    const headers=new Headers(request.headers);headers.set('cookie',`dg_student=${token}`);request=new Request(request.url,{headers});
  } else if(action==='logout'){
    const token=rawToken(request);if(token)await sql('DELETE FROM sessions WHERE hash=?',await hash(token)).run();cookie=tokenCookie(request,'',0);
    const headers=new Headers(request.headers);headers.delete('cookie');request=new Request(request.url,{headers});
  } else if(action==='saveStudent'){
    const classroom=teacher();const data=input.student??{};const studentId=data.id?text(data.id,'Student ID',60):id();const existing=data.id?await one('SELECT * FROM students WHERE id=? AND classroom_id=?',studentId,classroom.id):null;
    if(data.id&&!existing)throw new ApiError('Student not found.',404);
    const name=text(data.name,'Student nickname',30),studentCode=code(data.code,'Student code'),avatar=text(data.avatar??'🌟','Avatar',16),theme=text(data.theme??'mint','Theme',24),levelId=String(data.levelId??'easy'),goal=int(data.goal??3,'Goal',1,20);
    if(!LEVELS.some(l=>l.id===levelId))throw new ApiError('Choose a valid starting level.');
    const duplicate=await one('SELECT id FROM students WHERE classroom_id=? AND code=? AND id<>?',classroom.id,studentCode,studentId);if(duplicate)throw new ApiError('That student code is already in use.');
    let secret=existing?.pin_hash;
    if(data.pin||!existing){const pin=text(data.pin,'PIN',12,4);if(!/^\d{4,12}$/.test(pin))throw new ApiError('Use a 4–12 digit PIN.');secret=await pinHash(pin);}
    if(existing){await sql('UPDATE students SET name=?,code=?,pin_hash=?,avatar=?,theme=?,level_id=?,goal=? WHERE id=? AND classroom_id=?',name,studentCode,secret,avatar,theme,levelId,goal,studentId,classroom.id).run();if(data.pin)await sql('DELETE FROM sessions WHERE student_id=?',studentId).run();}
    else await sql('INSERT INTO students(id,classroom_id,code,pin_hash,name,avatar,theme,level_id,goal) VALUES(?,?,?,?,?,?,?,?,?)',studentId,classroom.id,studentCode,secret,name,avatar,theme,levelId,goal).run();
  } else if(action==='settings'){
    const classroom=teacher();const settings=input.settings??{};const previous=parse<Classroom>(classroom.data);
    if(!Array.isArray(settings.prizes)||settings.prizes.length>20)throw new ApiError('Add up to 20 prizes.');
    const prizes:Prize[]=settings.prizes.map((p:Row)=>({id:text(p.id,'Prize ID',50),name:text(p.name,'Prize name',50),description:text(p.description??'Teacher-approved prize','Description',160),cost:int(p.cost,'Prize cost',1,10000),icon:text(p.icon??'star','Prize icon',24)}));
    if(new Set(prizes.map(p=>p.id)).size!==prizes.length)throw new ApiError('Each prize needs its own ID.');
    const next:Classroom={...previous,name:text(settings.name,'Class name',60),teacherName:text(settings.teacherName,'Teacher name',40),powerups:!!settings.powerups,leaderboard:!!settings.leaderboard,prizes};
    await sql('UPDATE classrooms SET data=? WHERE id=? AND owner=?',JSON.stringify(next),classroom.id,user!.userId).run();
  } else if(action==='nudge'||action==='resolveHelp'){
    const classroom=teacher();const target=await one('SELECT * FROM students WHERE id=? AND classroom_id=?',text(input.studentId,'Student ID',60),classroom.id);if(!target)throw new ApiError('Student not found.',404);
    if(action==='nudge'){const message=text(input.message,'Coaching message',200);await sql('UPDATE students SET teacher_note=? WHERE id=?',message,target.id).run();await log(target,classroom,'Teacher sent a coaching message');}
    else {await sql('UPDATE students SET help_requested=0 WHERE id=?',target.id).run();await log(target,classroom,'Teacher marked help request as resolved');}
  } else if(action==='fulfill'){
    const classroom=teacher();const r=await one('SELECT * FROM redemptions WHERE id=? AND classroom_id=?',text(input.redemptionId,'Prize request ID',60),classroom.id);if(!r)throw new ApiError('Prize request not found.',404);
    if(!['approved','delivered'].includes(input.status))throw new ApiError('Choose an allowed prize status.');const data=parse<Redemption>(r.data);if(data.status==='delivered'&&input.status!=='delivered')throw new ApiError('This prize was already delivered.');data.status=input.status;await sql('UPDATE redemptions SET data=? WHERE id=?',JSON.stringify(data),r.id).run();
  } else if(action==='profile'){
    const target=learner();await sql('UPDATE students SET avatar=?,theme=?,last_seen=? WHERE id=?',text(input.avatar,'Avatar',16),text(input.theme,'Theme',24),now(),target.id).run();
  } else if(action==='help'){
    const target=learner();const message=input.message?text(input.message,'Help message',200):'I would like help with my puzzle.';await sql('UPDATE students SET help_requested=1,last_seen=? WHERE id=?',now(),target.id).run();await log(target,c!,`Help requested: ${message}`);
  } else if(action==='redemption'){
    const target=learner();const classroom=parse<Classroom>(c!.data);const prize=classroom.prizes.find(p=>p.id===input.prizeId);if(!prize)throw new ApiError('This prize is no longer available.');
    const requestId=id();const data:Redemption={id:requestId,studentId:target.id,studentName:target.name,prizeName:prize.name,cost:prize.cost,status:'pending',createdAt:now()};
    const results=await db().batch([sql('UPDATE students SET coins=coins-? WHERE id=? AND coins>=?',prize.cost,target.id,prize.cost),sql('INSERT INTO redemptions(id,student_id,classroom_id,data,created_at) SELECT ?,?,?,?,? WHERE changes()=1',requestId,target.id,c!.id,JSON.stringify(data),data.createdAt)]);
    if(!results[0].meta.changes)throw new ApiError('Keep solving! You need more coins for that prize.');await log(target,c!,`Requested prize: ${prize.name}`);
  } else if(action==='start'){
    const target=learner();const levelId=String(input.levelId);if(!LEVELS.some(l=>l.id===levelId))throw new ApiError('Choose a valid level.');const g=newGame(levelId);
    await db().batch([sql('UPDATE games SET status=\'paused\',data=json_set(data,\'$.status\',\'paused\') WHERE student_id=? AND status=\'playing\'',target.id),sql('INSERT INTO games(id,student_id,status,revision,data,updated_at) VALUES(?,?,?,?,?,?)',g.id,target.id,g.status,g.revision,JSON.stringify(g),g.updatedAt),sql('UPDATE students SET last_seen=?,help_requested=0 WHERE id=?',now(),target.id)]);
    await log(target,c!,`Started ${LEVELS.find(l=>l.id===levelId)!.name} puzzle`);
  } else if(['move','note','undo','pause','resume','powerup','heartbeat'].includes(action)){
    const target=learner();const active=await latestGame(target.id);if(!active){if(action==='heartbeat'){await sql('UPDATE students SET last_seen=? WHERE id=?',now(),target.id).run();}else throw new ApiError('Start a puzzle first.');}
    else if(active.game.status==='completed'&&action==='heartbeat'){await sql('UPDATE students SET last_seen=? WHERE id=?',now(),target.id).run();}
    else {
      if(input.gameId&&input.gameId!==active.game.id)throw new ApiError('This puzzle was replaced in another tab. Refresh to continue.',409);
      if(input.revision!==undefined&&input.revision!==active.game.revision)throw new ApiError('Your game changed in another tab. Refresh and try again.',409);
      let next;try{next=editGame(active.game,input,parse<Classroom>(c!.data).powerups);}catch(e){throw new ApiError(e instanceof Error?e.message:'Invalid move.');}
      const g=next.game;scan=next.scan;const statements=[sql('UPDATE games SET data=?,revision=?,status=?,updated_at=? WHERE id=? AND revision=?',JSON.stringify(g),g.revision,g.status,g.updatedAt,g.id,active.row.revision)];
      if(g.status==='completed'){
        const coins=earnedCoins(g);const record:ScoreRecord={id:g.id,studentId:target.id,studentName:target.name,levelId:g.levelId,seconds:g.elapsed,mistakes:g.mistakes,hints:g.hints,coins,assisted:g.usedPowerups,completedAt:now()};const bestPath='$.'+g.levelId;
        statements.push(sql('INSERT OR IGNORE INTO records(id,game_id,student_id,classroom_id,data,completed_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM games WHERE id=? AND revision=? AND status=\'completed\')',record.id,g.id,target.id,c!.id,JSON.stringify(record),record.completedAt,g.id,g.revision));
        statements.push(sql('UPDATE students SET coins=coins+?,total_solved=total_solved+1,streak=CASE WHEN ?=0 THEN streak+1 ELSE 0 END,best=CASE WHEN ?=0 AND (json_extract(best,?) IS NULL OR json_extract(best,?)>?) THEN json_set(best,?,?) ELSE best END,last_seen=?,help_requested=0 WHERE id=? AND changes()=1',coins,g.mistakes,g.usedPowerups?1:0,bestPath,bestPath,g.elapsed,bestPath,g.elapsed,now(),target.id));
      }
      statements.push(sql('UPDATE students SET last_seen=? WHERE id=?',now(),target.id));const result=await db().batch(statements);if(!result[0].meta.changes)throw new ApiError('Your game changed in another tab. Refresh and try again.',409);
      if(g.status==='completed')await log(target,c!,`Solved ${LEVELS.find(l=>l.id===g.levelId)!.name} in ${g.elapsed}s${g.usedPowerups?' with power-ups':''}`);
      else if(action==='powerup')await log(target,c!,`Used ${String(input.kind)} power-up`);
      else if(action==='pause'||action==='resume')await log(target,c!,action==='pause'?'Paused the puzzle':'Resumed the puzzle');
    }
  } else throw new ApiError('Unknown game action.');
  const result=await state(request,user);if(scan)result.scan=scan;return json(result,200,cookie);
 } catch(e){return failure(e);}
}
