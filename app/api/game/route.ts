import { env } from 'cloudflare:workers';
import { getChatGPTUser, type ChatGPTUser } from '../../chatgpt-auth';
import { LEVELS } from '../../../lib/sudoku';
import { newGame, editGame, publicGame, earnedCoins, type StoredGame } from '../../../lib/server-game';
import {normalizeStudentName,studentNameKey,registeredStudentCode,isRegisteredStudentCode,registrationAvatar} from '../../../lib/registration';
import {AVATAR_COLORS,AVATAR_FACES,AVATAR_ITEMS,avatarUpgradeCost,readBlockAvatar,earnedAwards} from '../../../lib/avatar';
import type { AppState, Classroom, Student, Game, ScoreRecord, Redemption, Activity, Prize } from '../../../lib/types';

export const dynamic='force-dynamic';
type Row=Record<string,any>;
class ApiError extends Error {constructor(message:string,public status=400,public code?:string){super(message);}}
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
function name(value:unknown){try{return normalizeStudentName(value);}catch(e){throw new ApiError(e instanceof Error?e.message:'Enter your name using 1–30 characters.');}}
const enrollmentOpen=(data:Classroom)=>data.allowRegistration!==false;
const duplicateNameMessage='That name already has an account. Use the existing account, or add your last initial to make your name different.';
function fourDigitPin(value:unknown){if(typeof value!=='string'||!/^\d{4}$/.test(value))throw new ApiError('Enter your four-digit PIN.');return value;}
function uniqueStudentConstraint(error:unknown){return /UNIQUE constraint failed: students\.(classroom_id|code)/i.test(error instanceof Error?error.message:String(error));}
async function nameAlreadyUsed(classroomId:string,displayName:string,exceptId?:string){const key=studentNameKey(displayName);const rows=await all('SELECT id,name FROM students WHERE classroom_id=?',classroomId);return rows.some(row=>{if(row.id===exceptId)return false;try{return studentNameKey(row.name)===key;}catch{return false;}});}
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
function student(row:Row):Student{return {id:row.id,name:row.name,code:row.code,avatar:row.avatar,theme:row.theme,blockAvatar:readBlockAvatar(row.block_avatar),awards:earnedAwards(row.awards,row.total_solved,row.streak),levelId:row.level_id,goal:row.goal,coins:row.coins,totalSolved:row.total_solved,streak:row.streak,best:parse(row.best),lastSeen:row.last_seen,helpRequested:!!row.help_requested,teacherNote:row.teacher_note};}
function publicClassroom(row:Row):Classroom{const data=parse<Classroom>(row.data);return {id:row.id,name:data.name,teacherName:data.teacherName,powerups:data.powerups,leaderboard:data.leaderboard,allowRegistration:enrollmentOpen(data),prizes:data.prizes};}
async function classroomRow(){return one('SELECT * FROM classrooms WHERE id = ?', 'main');}
async function currentStudent(request:Request){const token=rawToken(request);if(!token||token.length>128)return null;return one('SELECT s.* FROM students s JOIN sessions a ON a.student_id=s.id WHERE a.hash=? AND a.expires_at>?',await hash(token),now());}
async function latestGame(studentId:string){const row=await one('SELECT * FROM games WHERE student_id=? ORDER BY updated_at DESC, rowid DESC LIMIT 1',studentId);return row?{row,game:parse<StoredGame>(row.data)}:null;}
async function log(s:Row,c:Row,message:string){const event:Activity={id:id(),studentId:s.id,studentName:s.name,text:message,at:now()};await sql('INSERT INTO activity(id,student_id,classroom_id,data,at) VALUES(?,?,?,?,?)',event.id,s.id,c.id,JSON.stringify(event),event.at).run();}

async function state(request:Request,user:ChatGPTUser|null):Promise<AppState>{
  const c=await classroomRow();const s=await currentStudent(request);const isTeacher=!!c&&user?.userId===c.owner;
  const base:AppState={user:user?{id:user.userId,name:user.displayName}:null,classroom:c?publicClassroom(c):null,isTeacher,student:s?student(s):null,game:null,records:[],leaderboard:[],redemptions:[]};
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
function failure(error:unknown){if(error instanceof ApiError)return json({error:error.message,...(error.code?{code:error.code}:{})},error.status);console.error('Classroom operation failed',error instanceof Error?error.message:'unknown');return json({error:'The classroom could not save this change. Please try again.'},500);}

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
  const learner=()=>{if(!c||!s||s.classroom_id!==c.id)throw new ApiError('Sign in with your name and PIN.',401);return s;};

  if(request.headers.get('x-sudoku-public-ingress')==='1'&&['login','register'].includes(action)){
    const stamp=now(),key='public-auth:'+await hash(request.headers.get('cf-connecting-ip')??'public-network');
    await sql('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END',key,stamp+900000,stamp,stamp,stamp+900000).run();
    const attempt=await one('SELECT count FROM login_attempts WHERE key=?',key);if(attempt&&attempt.count>120)throw new ApiError('Too many sign-in attempts from this network. Wait 15 minutes or ask your teacher for help.',429);
  }

  if(action==='setup'){
    if(!user)throw new ApiError('Sign in with ChatGPT to create your classroom.',401);
    if(!c&&env.CLASSROOM_TEACHER_EMAIL&&user.email.toLowerCase()!==env.CLASSROOM_TEACHER_EMAIL.toLowerCase())throw new ApiError('Sign in with the teacher account that owns this game to set up the classroom.',403);
    const name=text(input.name,'Class name',60),teacherName=text(input.teacherName,'Teacher name',40);
    if(c){if(c.owner!==user.userId)throw new ApiError('This classroom already has a teacher.',403);}
    else {
      const storageKey='room-'+hex(crypto.getRandomValues(new Uint8Array(8)));
      const prizes:Prize[]=[];
      const data:Classroom={id:'main',name,teacherName,powerups:true,leaderboard:false,allowRegistration:true,prizes};
      await sql('INSERT OR IGNORE INTO classrooms(id,owner,code,data) VALUES(?,?,?,?)','main',user.userId,storageKey,JSON.stringify(data)).run();
      c=await classroomRow();if(c?.owner!==user.userId)throw new ApiError('This classroom already has a teacher.',403);
    }
  } else if(action==='roster'){
    if(request.headers.get('x-sudoku-public-ingress')==='1')throw new ApiError('Enter your own name and four-digit PIN to sign in.',403);
    if(!c)return json({classroom:null,students:[]});
    const stamp=now();
    const key='roster:'+await hash(request.headers.get('cf-connecting-ip')??'shared-network');
    await sql('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END',key,stamp+60000,stamp,stamp,stamp+60000).run();
    const attempt=await one('SELECT count FROM login_attempts WHERE key=?',key);if(attempt&&attempt.count>120)throw new ApiError('Please wait a minute before loading classroom names again.',429);
    const roster=await all('SELECT id,name,avatar FROM students WHERE classroom_id=? ORDER BY name,id',c.id);
    return json({classroom:{name:parse<Classroom>(c.data).name},students:roster.map(r=>({id:r.id,name:r.name,avatar:r.avatar}))});
  } else if(action==='register'){
    if(!c)throw new ApiError('Your teacher needs to set up the classroom before you can create an account.',409);
    if(!enrollmentOpen(parse<Classroom>(c.data)))throw new ApiError('New accounts are closed right now. Ask your teacher for help.',403);
    if(s)throw new ApiError('Sign out of the current student account before creating another account.',409);
    const displayName=name(input.name),pin=fourDigitPin(input.pin);
    if(input.confirmPin!==undefined&&pin!==input.confirmPin)throw new ApiError('Your PINs do not match.');
    const stamp=now(),ip=request.headers.get('cf-connecting-ip')??'shared-network',attemptKey='enrollment:'+await hash(ip);
    await sql('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END',attemptKey,stamp+600000,stamp,stamp,stamp+600000).run();
    const attempt=await one('SELECT count FROM login_attempts WHERE key=?',attemptKey);if(attempt&&attempt.count>60)throw new ApiError('This classroom has created many accounts. Please wait 10 minutes or ask your teacher for help.',429);
    if(await nameAlreadyUsed(c.id,displayName))throw new ApiError(duplicateNameMessage,409);
    const studentId=id(),studentCode=await registeredStudentCode(displayName),secret=await pinHash(pin),avatar=registrationAvatar(input.avatar),token=hex(crypto.getRandomValues(new Uint8Array(32)));
    const event:Activity={id:id(),studentId,studentName:displayName,text:'Created an account and ready to solve',at:stamp};
    let results:D1Result[];
    try{
      results=await db().batch([
        sql('INSERT INTO students(id,classroom_id,code,pin_hash,name,avatar,theme,level_id,goal,last_seen) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM classrooms WHERE id=? AND COALESCE(json_extract(data,\'$.allowRegistration\'),1)=1)',studentId,c.id,studentCode,secret,displayName,avatar,'navy','easy',2,stamp,c.id),
        sql('INSERT INTO sessions(hash,student_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM students WHERE id=?)',await hash(token),studentId,stamp+28800000,studentId),
        sql('INSERT INTO activity(id,student_id,classroom_id,data,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM students WHERE id=?)',event.id,studentId,c.id,JSON.stringify(event),stamp,studentId)
      ]);
    }catch(e){if(uniqueStudentConstraint(e))throw new ApiError(duplicateNameMessage,409);throw e;}
    if(!results[0].meta.changes)throw new ApiError('New accounts are closed right now. Ask your teacher for help.',403);
    cookie=tokenCookie(request,token);
    const headers=new Headers(request.headers);headers.set('cookie',`dg_student=${token}`);request=new Request(request.url,{headers});
  } else if(action==='login'){
    const displayName=input.name!==undefined?name(input.name):null;
    const studentId=!displayName&&input.studentId?text(input.studentId,'Student',60):null,studentCode=!displayName&&!studentId?code(input.studentCode,'Student'):null,pin=fourDigitPin(input.pin);
    const key=await hash('main:'+(displayName?'name:'+studentNameKey(displayName):studentId?'id:'+studentId:'code:'+studentCode)),stamp=now();
    await sql('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END',key,stamp+900000,stamp,stamp,stamp+900000).run();
    const attempt=await one('SELECT count FROM login_attempts WHERE key=?',key);if(attempt&&attempt.count>10)throw new ApiError('Too many sign-in attempts. Ask your teacher and try again in 15 minutes.',429);
    const candidates=c?(displayName?(await all('SELECT * FROM students WHERE classroom_id=?',c.id)).filter(row=>{try{return studentNameKey(row.name)===studentNameKey(displayName);}catch{return false;}}):await all(studentId?'SELECT * FROM students WHERE classroom_id=? AND id=?':'SELECT * FROM students WHERE classroom_id=? AND code=?',c.id,studentId??studentCode)):[];
    if(!candidates.length)throw new ApiError('No account was found for that name. Check your spelling. If this is your first visit, choose Create a new account.',401,'ACCOUNT_NOT_FOUND');
    const matches:Row[]=[];
    for(const candidate of candidates)if(await verifyPin(pin,candidate.pin_hash))matches.push(candidate);
    if(!matches.length)throw new ApiError('That name already has an account, but the PIN does not match. Try your usual PIN or ask your teacher to reset it. Your scores and rewards are saved in that account.',401,'PIN_INCORRECT');
    if(matches.length>1)throw new ApiError('More than one saved account has this name and PIN. Ask your teacher to add a last initial to your account name.',409,'ACCOUNT_AMBIGUOUS');
    const target=matches[0];
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
    const displayName=name(data.name),studentCode=existing&&isRegisteredStudentCode(existing.code)?await registeredStudentCode(displayName):(data.code?code(data.code,'Student code'):(existing?.code??await registeredStudentCode(displayName))),avatar=text(data.avatar??'🐬','Avatar',16),theme=text(data.theme??'navy','Theme',24),levelId=String(data.levelId??'easy'),goal=int(data.goal??3,'Goal',1,20);
    if(!LEVELS.some(l=>l.id===levelId))throw new ApiError('Choose a valid starting level.');
    if((!existing||studentNameKey(existing.name)!==studentNameKey(displayName))&&await nameAlreadyUsed(classroom.id,displayName,studentId))throw new ApiError(duplicateNameMessage,409);
    const duplicate=await one('SELECT id FROM students WHERE classroom_id=? AND code=? AND id<>?',classroom.id,studentCode,studentId);if(duplicate)throw new ApiError('That student code is already in use.');
    let secret=existing?.pin_hash;
    if(data.pin||!existing){const pin=fourDigitPin(data.pin);secret=await pinHash(pin);}
    try{
      if(existing){await sql('UPDATE students SET name=?,code=?,pin_hash=?,avatar=?,theme=?,level_id=?,goal=? WHERE id=? AND classroom_id=?',displayName,studentCode,secret,avatar,theme,levelId,goal,studentId,classroom.id).run();if(data.pin)await sql('DELETE FROM sessions WHERE student_id=?',studentId).run();}
      else await sql('INSERT INTO students(id,classroom_id,code,pin_hash,name,avatar,theme,level_id,goal) VALUES(?,?,?,?,?,?,?,?,?)',studentId,classroom.id,studentCode,secret,displayName,avatar,theme,levelId,goal).run();
    }catch(e){if(uniqueStudentConstraint(e))throw new ApiError(isRegisteredStudentCode(studentCode)?duplicateNameMessage:'That student code is already in use.',409);throw e;}
  } else if(action==='settings'){
    const classroom=teacher();const settings=input.settings??{};const previous=parse<Classroom>(classroom.data);
    if(!Array.isArray(settings.prizes)||settings.prizes.length>20)throw new ApiError('Add up to 20 prizes.');
    const prizes:Prize[]=settings.prizes.map((p:Row)=>({id:text(p.id,'Prize ID',50),name:text(p.name,'Prize name',50),description:text(p.description??'Teacher-approved prize','Description',160),cost:int(p.cost,'Prize cost',1,10000),icon:text(p.icon??'star','Prize icon',24)}));
    if(new Set(prizes.map(p=>p.id)).size!==prizes.length)throw new ApiError('Each prize needs its own ID.');
    if(settings.allowRegistration!==undefined&&typeof settings.allowRegistration!=='boolean')throw new ApiError('Choose whether students can create accounts.');
    const next:Classroom={...previous,name:text(settings.name,'Class name',60),teacherName:text(settings.teacherName,'Teacher name',40),powerups:!!settings.powerups,leaderboard:!!settings.leaderboard,allowRegistration:settings.allowRegistration===undefined?enrollmentOpen(previous):settings.allowRegistration,prizes};
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
  } else if(action==='avatar'){
    const target=learner();const {color,face,accessory}=input;
    if(!AVATAR_COLORS.some(item=>item.id===color)||!AVATAR_FACES.some(item=>item.id===face)||!['none',...AVATAR_ITEMS.map(item=>item.id)].includes(accessory))throw new ApiError('Choose a block color, face, and accessory from your collection.');
    const result=await sql("UPDATE students SET block_avatar=json_set(block_avatar,'$.color',?,'$.face',?,'$.accessory',?),last_seen=? WHERE id=? AND (?='none' OR EXISTS(SELECT 1 FROM json_each(block_avatar,'$.owned') WHERE value=?))",color,face,accessory,now(),target.id,accessory,accessory).run();
    if(!result.meta.changes)throw new ApiError('Earn this accessory in the block shop before wearing it.',409);
  } else if(action==='avatarBuy'){
    const target=learner();const item=AVATAR_ITEMS.find(item=>item.id===input.itemId);if(!item)throw new ApiError('Choose an accessory from the block shop.');
    const result=await sql("UPDATE students SET coins=coins-?,block_avatar=json_insert(block_avatar,'$.owned[#]',?),last_seen=? WHERE id=? AND coins>=? AND NOT EXISTS(SELECT 1 FROM json_each(block_avatar,'$.owned') WHERE value=?)",item.cost,item.id,now(),target.id,item.cost,item.id).run();
    if(!result.meta.changes)throw new ApiError('You already own this accessory, or need more coins. Your coins are safe.',409);
    await log(target,c!,`Unlocked block accessory: ${item.name}`);
  } else if(action==='avatarUpgrade'){
    const target=learner();const avatar=readBlockAvatar(target.block_avatar),cost=avatarUpgradeCost(avatar.level);
    if(cost===null)throw new ApiError('Your block buddy is already at the highest level.');
    const result=await sql("UPDATE students SET coins=coins-?,block_avatar=json_set(block_avatar,'$.level',?),last_seen=? WHERE id=? AND coins>=? AND json_extract(block_avatar,'$.level')=?",cost,avatar.level+1,now(),target.id,cost,avatar.level).run();
    if(!result.meta.changes)throw new ApiError('You need more coins, or your buddy was already upgraded. Refresh your collection.',409);
    await log(target,c!,`Upgraded block buddy to level ${avatar.level+1}`);
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
        const awards:Record<string,boolean>={};
        for(const award of earnedAwards(target.awards,target.total_solved+1,g.mistakes===0?target.streak+1:0))awards[award]=true;
        if(g.mistakes===0&&!g.usedPowerups)awards.perfect=true;
        statements.push(sql('UPDATE students SET coins=coins+?,total_solved=total_solved+1,streak=CASE WHEN ?=0 THEN streak+1 ELSE 0 END,best=CASE WHEN ?=0 AND (json_extract(best,?) IS NULL OR json_extract(best,?)>?) THEN json_set(best,?,?) ELSE best END,awards=json_patch(awards,?),last_seen=?,help_requested=0 WHERE id=? AND changes()=1',coins,g.mistakes,g.usedPowerups?1:0,bestPath,bestPath,g.elapsed,bestPath,g.elapsed,JSON.stringify(awards),now(),target.id));
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
