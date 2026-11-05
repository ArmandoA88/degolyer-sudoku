import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getAsset, isSea } from 'node:sea';
import { LocalDatabase, type Migration } from './db';
import { setLocalDatabase } from './cloudflare';
import { localTeacher, withLocalIdentity } from './auth';
import { GET, POST } from '../app/api/game/route';

type Asset={content:string;mime:string};
type Options={port:number;host:string;dataDir:string;noOpen:boolean;assets?:string;migrations?:string};
class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
const token=()=>randomBytes(24).toString('hex');
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const equal=(left:string,right:string)=>{const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);};
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
const loopbackSocket=(value:string|undefined)=>!!value&&(value==='::1'||value==='127.0.0.1'||value.startsWith('127.')||value.startsWith('::ffff:127.'));
const loopbackHost=(value:string)=>value==='localhost'||value==='[::1]'||/^127\.\d+\.\d+\.\d+$/.test(value);
const cookieValue=(request:IncomingMessage,name:string)=>request.headers.cookie?.split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='))?.slice(name.length+1)??'';
const teacherCookie=(value:string,seconds=28800)=>`dg_teacher=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}`;

function options():Options|null{
  const args=process.argv.slice(2);
  if(args.includes('--help')){
    console.log('DeGolyer ES Sudoku Server\n\nDouble-click the EXE to start the game and open teacher setup.\n\nOptions: --port 8787 --host 0.0.0.0 --data-dir PATH --no-open\nDeveloper options: --assets FILE --migrations FILE\n\nStudent data is saved in SudokuData beside the EXE. Keep that folder when moving the server.');
    return null;
  }
  if(args.includes('--version')){console.log('DeGolyer ES Sudoku Server 1.0.0');return null;}
  const executableFolder=isSea()?dirname(process.execPath):process.cwd();
  const result:Options={port:8787,host:'0.0.0.0',dataDir:join(executableFolder,'SudokuData'),noOpen:false};
  for(let index=0;index<args.length;index++){
    const flag=args[index];
    if(flag==='--no-open'){result.noOpen=true;continue;}
    if(!['--port','--host','--data-dir','--assets','--migrations'].includes(flag))throw new Error(`Unknown option ${flag}. Run with --help for instructions.`);
    const value=args[++index];if(!value||value.startsWith('--'))throw new Error(`A value is required for ${flag}.`);
    if(flag==='--port'){result.port=Number(value);if(!Number.isInteger(result.port)||result.port<1||result.port>65535)throw new Error('Choose a port from 1 to 65535.');}
    else if(flag==='--host'){if(!/^[a-zA-Z0-9:.%-]+$/.test(value))throw new Error('Invalid server host.');result.host=value;}
    else if(flag==='--data-dir')result.dataDir=resolve(value);
    else if(flag==='--assets')result.assets=resolve(value);
    else result.migrations=resolve(value);
  }
  return result;
}

function embeddedJson<T>(name:string,filename:string|undefined):T{
  if(isSea())return JSON.parse(getAsset(name,'utf8')) as T;
  if(!filename)throw new Error(`Developer mode needs --${name==='web-assets.json'?'assets':'migrations'} FILE. The standalone EXE already contains these files.`);
  return JSON.parse(readFileSync(filename,'utf8')) as T;
}
function passwordHash(password:string){const salt=randomBytes(16).toString('hex');return `scrypt$${salt}$${scryptSync(password,salt,32).toString('hex')}`;}
function verifyPassword(password:string,stored:string){const [method,salt,expected]=stored.split('$');return method==='scrypt'&&!!salt&&!!expected&&equal(scryptSync(password,salt,32).toString('hex'),expected);}
function commonHeaders(response:ServerResponse){
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('X-Frame-Options','DENY');response.setHeader('Referrer-Policy','no-referrer');
}
function sendJson(response:ServerResponse,status:number,value:unknown){commonHeaders(response);response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
function redirect(response:ServerResponse,path='/',cookies:string[]=[]){commonHeaders(response);response.writeHead(303,{'Location':path,'Cache-Control':'no-store',...(cookies.length?{'Set-Cookie':cookies}:{})});response.end();}
function body(request:IncomingMessage,limit=20000):Promise<Buffer>{
  return new Promise((resolveBody,reject)=>{
    if(Number(request.headers['content-length']??0)>limit){request.resume();reject(new HttpError(413,'This request is too large.'));return;}
    let length=0,ended=false;const chunks:Buffer[]=[];
    request.on('data',(chunk:Buffer)=>{if(ended)return;length+=chunk.length;if(length>limit){ended=true;chunks.length=0;reject(new HttpError(413,'This request is too large.'));}else chunks.push(chunk);});
    request.on('end',()=>{if(!ended){ended=true;resolveBody(Buffer.concat(chunks));}});
    request.on('error',error=>{if(!ended){ended=true;reject(error);}});
  });
}

function teacherPage(configured:boolean,csrf:string,setupToken:string,error='',signedIn=false){
  const title=configured?'Teacher sign-in':'Set up your teacher password';
  const tokenField=setupToken?`<input type="hidden" name="setupToken" value="${escapeHtml(setupToken)}">`:`<label>Setup code from the server window<input name="setupToken" required autocomplete="off" spellcheck="false"></label>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · DeGolyer ES</title><style>body{margin:0;background:#f7f8f3;color:#173e3e;font-family:Arial,sans-serif;display:grid;min-height:100vh;place-items:center}main{width:min(430px,calc(100% - 64px));padding:32px;border:1px solid #dce5d5;border-radius:18px;background:white}small{letter-spacing:2px;font-weight:bold}h1{font-size:28px;line-height:1.2}p{line-height:1.7;color:#65765e}label{display:block;margin:20px 0 8px;font-weight:bold;font-size:14px}input{box-sizing:border-box;display:block;width:100%;font:inherit;padding:13px;border:1px solid #b7c5ab;border-radius:8px;margin-top:9px}button,a{display:inline-block;padding:13px 18px;background:#173e3e;color:white;border:0;border-radius:8px;font-weight:bold;cursor:pointer;font-size:14px;text-decoration:none;margin-top:14px}a.secondary{background:#edf2dc;color:#173e3e;margin-left:8px}.error{background:#fce9e2;color:#963d2c;padding:12px;border-radius:8px}footer{margin-top:24px;font-size:12px;line-height:1.7;color:#748269}</style><main><small>DEGOLYER ES · SUDOKU STUDIO</small><h1>${title}</h1>${signedIn?'<p>You are signed in as the teacher on this computer.</p><a href="/">Open classroom</a><a class="secondary" href="/signout-with-chatgpt">Sign out</a>':`<p>${configured?'Enter the teacher password you created for this server.':'Create a password to protect the teacher dashboard. You will use it on this computer to manage students and rewards.'}</p>${error?`<p class="error" role="alert">${escapeHtml(error)}</p>`:''}<form method="post" action="/teacher"><input type="hidden" name="mode" value="${configured?'login':'setup'}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${configured?'':tokenField}<label>Teacher password<input type="password" name="password" required minlength="8" maxlength="128" autocomplete="${configured?'current-password':'new-password'}"></label>${configured?'':'<label>Confirm password<input type="password" name="confirmPassword" required minlength="8" maxlength="128" autocomplete="new-password"></label>'}<button type="submit">${configured?'Sign in':'Save teacher password'}</button></form>`}<footer>Teacher access is available only on the server computer.<br>Students use the network link, their name, and their own PIN.</footer></main></html>`;
}

async function main(){
  const config=options();if(!config)return;
  const assets=embeddedJson<Record<string,Asset>>('web-assets.json',config.assets);
  const migrations=embeddedJson<Migration[]>('migrations.json',config.migrations);
  if(!assets['/index.html'])throw new Error('The embedded game page is missing. Rebuild the server EXE.');
  const staticAssets=new Map(Object.entries(assets).map(([path,asset])=>[path,{bytes:Buffer.from(asset.content,'base64'),mime:asset.mime}]));
  const databaseFile=join(config.dataDir,'classroom.sqlite');
  const database=new LocalDatabase(databaseFile,migrations);setLocalDatabase(database);
  const sql=database.sqlite;
  const configured=()=>!!sql.prepare('SELECT id FROM _standalone_auth WHERE id=1').get();
  const setupCode=token();
  const privateAddress=(address:string)=>/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(address);
  const ipv4=Object.values(networkInterfaces()).flat().filter(item=>item&&!item.internal&&item.family==='IPv4').map(item=>item!.address).sort((a,b)=>Number(privateAddress(b))-Number(privateAddress(a)));
  const allowedHosts=new Set(['localhost','127.0.0.1','[::1]',hostname().toLowerCase(),...ipv4]);
  if(config.host!=='0.0.0.0'&&config.host!=='::')allowedHosts.add(config.host.toLowerCase());
  const teacherAuthenticated=(request:IncomingMessage,isLocal:boolean)=>{
    if(!isLocal)return false;const session=cookieValue(request,'dg_teacher');if(!/^[a-f0-9]{48}$/.test(session))return false;
    return !!sql.prepare('SELECT hash FROM _standalone_teacher_sessions WHERE hash=? AND expires_at>?').get(digest(session),Date.now());
  };
  const server=createServer(async(request,response)=>{
    try{
      const host=request.headers.host;if(!host||!/^[a-zA-Z0-9.[\]:-]+$/.test(host))throw new HttpError(400,'Invalid server address.');
      const url=new URL(request.url??'/',`http://${host}`);
      if(!allowedHosts.has(url.hostname.toLowerCase()))throw new HttpError(403,'Open the server using its displayed classroom network link.');
      const isLocal=loopbackSocket(request.socket.remoteAddress)&&loopbackHost(url.hostname.toLowerCase());
      const isTeacher=teacherAuthenticated(request,isLocal);
      if(url.pathname==='/api/server-info'&&request.method==='GET'){
        const wildcard=config.host==='0.0.0.0'||config.host==='::';
        const shareHost=wildcard?ipv4[0]??(loopbackHost(url.hostname)?'127.0.0.1':url.hostname):config.host;
        const formatted=shareHost.includes(':')&&!shareHost.startsWith('[')?`[${shareHost}]`:shareHost;
        sendJson(response,200,{shareOrigin:`http://${formatted}:${config.port}`,localOrigin:`http://127.0.0.1:${config.port}`});return;
      }
      if(url.pathname==='/health'&&request.method==='GET'){sendJson(response,200,{ok:true,app:'DeGolyer ES Sudoku Server'});return;}
      if(url.pathname==='/teacher'||url.pathname==='/signin-with-chatgpt'){
        if(!isLocal)throw new HttpError(403,'Teacher sign-in is available only on the server computer. Students should open the classroom link and select their name.');
        if(request.method==='GET'){
          const csrf=token(),setup=equal(url.searchParams.get('setup')??'',setupCode)?setupCode:'';
          commonHeaders(response);response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'Set-Cookie':`dg_teacher_csrf=${csrf}; HttpOnly; SameSite=Strict; Path=/teacher; Max-Age=600`});response.end(teacherPage(configured(),csrf,setup,'',isTeacher));return;
        }
        if(request.method!=='POST')throw new HttpError(405,'Use the teacher sign-in form.');
        const origin=request.headers.origin;if(origin&&origin!==url.origin)throw new HttpError(403,'Open the teacher sign-in page on this computer first.');
        if(request.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Open the teacher sign-in page on this computer first.');
        if(!request.headers['content-type']?.includes('application/x-www-form-urlencoded'))throw new HttpError(415,'Use the teacher sign-in form.');
        const form=new URLSearchParams((await body(request)).toString('utf8'));
        const csrf=form.get('csrf')??'',csrfCookie=cookieValue(request,'dg_teacher_csrf');
        if(!/^[a-f0-9]{48}$/.test(csrf)||!equal(csrf,csrfCookie))throw new HttpError(403,'The sign-in form expired. Reload the teacher page and try again.');
        const password=form.get('password')??'';
        const stamp=Date.now(),key='teacher-login';
        sql.prepare('INSERT INTO _standalone_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END').run(key,stamp+900000,stamp,stamp,stamp+900000);
        const attempts=sql.prepare('SELECT count FROM _standalone_limits WHERE key=?').get(key) as {count:number};
        if(attempts.count>10)throw new HttpError(429,'Too many teacher sign-in attempts. Wait 15 minutes and try again.');
        if(password.length<8||password.length>128)throw new HttpError(400,'Use a teacher password with 8–128 characters.');
        const auth=sql.prepare('SELECT password_hash FROM _standalone_auth WHERE id=1').get() as {password_hash:string}|undefined;
        if(!auth){
          if(!equal(form.get('setupToken')??'',setupCode))throw new HttpError(403,'Use the teacher setup link displayed in the server window.');
          if(password!==(form.get('confirmPassword')??''))throw new HttpError(400,'The two passwords do not match.');
          sql.prepare('INSERT INTO _standalone_auth(id,password_hash) VALUES(1,?)').run(passwordHash(password));
        }else if(!verifyPassword(password,auth.password_hash))throw new HttpError(401,'The teacher password is incorrect.');
        const session=token();
        sql.prepare('DELETE FROM _standalone_teacher_sessions WHERE expires_at<?').run(stamp);
        sql.prepare('INSERT INTO _standalone_teacher_sessions(hash,expires_at) VALUES(?,?)').run(digest(session),stamp+28800000);
        sql.prepare('DELETE FROM _standalone_limits WHERE key=?').run(key);
        redirect(response,'/',[teacherCookie(session),'dg_teacher_csrf=; HttpOnly; SameSite=Strict; Path=/teacher; Max-Age=0']);return;
      }
      if(url.pathname==='/signout-with-chatgpt'){
        if(!isLocal)throw new HttpError(403,'Teacher access is available only on the server computer.');
        const session=cookieValue(request,'dg_teacher');if(session)sql.prepare('DELETE FROM _standalone_teacher_sessions WHERE hash=?').run(digest(session));
        redirect(response,'/',[teacherCookie('',0)]);return;
      }
      if(url.pathname==='/api/game'){
        if(request.method!=='GET'&&request.method!=='POST')throw new HttpError(405,'This game action is not supported.');
        const headers=new Headers();
        for(const [name,value] of Object.entries(request.headers)){
          if(value===undefined||name.startsWith('oai-')||name.startsWith('x-forwarded-')||['connection','transfer-encoding','content-length'].includes(name))continue;
          if(Array.isArray(value))headers.set(name,value.join(', '));else headers.set(name,value);
        }
        headers.set('cf-connecting-ip',request.socket.remoteAddress??'local');
        const payload=request.method==='POST'?await body(request):undefined;
        const gameRequest=new Request(url,{method:request.method,headers,...(payload?{body:new Uint8Array(payload)}:{})});
        const result=await withLocalIdentity(isTeacher?localTeacher:null,()=>request.method==='GET'?GET(gameRequest):POST(gameRequest));
        commonHeaders(response);response.statusCode=result.status;
        result.headers.forEach((value,name)=>{if(name.toLowerCase()!=='set-cookie')response.setHeader(name,value);});
        const cookies=result.headers.getSetCookie();if(cookies.length)response.setHeader('Set-Cookie',cookies);
        response.end(Buffer.from(await result.arrayBuffer()));return;
      }
      if(request.method!=='GET'&&request.method!=='HEAD')throw new HttpError(405,'This page does not accept changes.');
      let path:string;try{path=decodeURIComponent(url.pathname);}catch{throw new HttpError(400,'Invalid page address.');}
      if(path.includes('\\')||path.split('/').some(part=>part.startsWith('.')&&part.length>0))throw new HttpError(404,'Page not found.');
      let asset=staticAssets.get(path==='/'?'/index.html':path);
      if(!asset&&!path.startsWith('/api/')&&!path.includes('.'))asset=staticAssets.get('/index.html');
      if(!asset)throw new HttpError(404,'Page not found.');
      commonHeaders(response);response.writeHead(200,{'Content-Type':asset.mime,'Content-Length':asset.bytes.length,'Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"});response.end(request.method==='HEAD'?undefined:asset.bytes);
    }catch(error){
      if(response.headersSent){response.end();return;}
      const status=error instanceof HttpError?error.status:500;
      if(status===500)console.error('Server request failed:',error instanceof Error?error.message:'Unknown error');
      sendJson(response,status,{error:error instanceof HttpError?error.message:'The server could not finish this request. Please try again.'});
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  try{await new Promise<void>((resolveListen,reject)=>{server.once('error',reject);server.listen(config.port,config.host,()=>{server.removeListener('error',reject);resolveListen();});});}
  catch(error){database.close();if((error as NodeJS.ErrnoException).code==='EADDRINUSE')throw new Error(`Port ${config.port} is already in use. The Sudoku server may already be running. Open http://127.0.0.1:${config.port}/ or run with --port 8788.`);throw error;}
  const teacherUrl=`http://127.0.0.1:${config.port}/teacher${configured()?'':'?setup='+setupCode}`;
  console.log('\nDeGolyer ES Sudoku Server\n=========================');
  console.log(`Local game: http://127.0.0.1:${config.port}/`);
  console.log(`${configured()?'Teacher dashboard':'Teacher setup'}: ${teacherUrl}`);
  if(config.host==='0.0.0.0'||config.host==='::'){
    for(const address of ipv4)console.log(`Student network: http://${address}:${config.port}/`);
    if(!ipv4.length)console.log('No active network address found. Connect this computer to the classroom network and restart to see its student link.');
  }
  console.log(`Student database: ${databaseFile}`);
  console.log('Keep this window open while students play. Press Ctrl+C to stop.\n');
  if(!config.noOpen&&process.platform==='win32')spawn('explorer.exe',[teacherUrl],{stdio:'ignore',windowsHide:true}).on('error',()=>console.log('Open the teacher link above in your browser.'));
  let closing=false;
  const stop=()=>{if(closing)return;closing=true;console.log('\nSaving classroom data and stopping the server…');server.close(()=>{database.close();process.exitCode=0;});server.closeIdleConnections();setTimeout(()=>{server.closeAllConnections();},3000).unref();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

void main().catch(error=>{
  console.error(`\nCould not start DeGolyer ES Sudoku Server: ${error instanceof Error?error.message:String(error)}\n`);
  process.exitCode=1;
  if(process.stdin.isTTY&&!process.argv.includes('--no-open')){console.log('Press Enter to close this window.');process.stdin.resume();process.stdin.once('data',()=>process.stdin.pause());}
});
