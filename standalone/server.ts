import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { getAsset, isSea } from 'node:sea';
import { LocalDatabase, type Migration } from './db';
import { setLocalDatabase } from './cloudflare';
import { localTeacher, withLocalIdentity } from './auth';
import { GET, POST } from '../app/api/game/route';
import { startQuickTunnel } from './tunnel';
import { resolveEmbeddedCloudflared } from './embedded-tunnel';

type Asset={content:string;mime:string};
type Options={port:number;host:string;dataDir:string;noOpen:boolean;tunnel:boolean;cloudflared?:string;assets?:string;migrations?:string};
class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
const loopbackSocket=(value:string|undefined)=>!!value&&(value==='::1'||value==='127.0.0.1'||value.startsWith('127.')||value.startsWith('::ffff:127.'));
const loopbackHost=(value:string)=>value==='localhost'||value==='[::1]'||/^127\.\d+\.\d+\.\d+$/.test(value);
function options():Options|null{
  const args=process.argv.slice(2);
  if(args.includes('--help')){
    console.log('DeGolyer ES Sudoku Server\n\nDouble-click this single EXE to open the app and create a public HTTPS student link through its bundled Cloudflare Tunnel. No separate installs or helper files are needed.\n\nOptions: --port 8787 --host 0.0.0.0 --data-dir PATH --no-open\n  --offline             Local network play without starting a public tunnel.\n  --tunnel              Start Cloudflare Tunnel (the EXE default; requires internet).\n  --cloudflared PATH    Override the bundled tunnel helper for troubleshooting.\nDeveloper options: --assets FILE --migrations FILE\n\nStudent data is saved in SudokuData beside the EXE. Keep that folder when moving the server.');
    return null;
  }
  if(args.includes('--version')){console.log('DeGolyer ES Sudoku Server 1.8.0');return null;}
  const executableFolder=isSea()?dirname(process.execPath):process.cwd();
  const result:Options={port:8787,host:'0.0.0.0',dataDir:join(executableFolder,'SudokuData'),noOpen:false,tunnel:isSea()};
  for(let index=0;index<args.length;index++){
    const flag=args[index];
    if(flag==='--no-open'){result.noOpen=true;continue;}
    if(flag==='--tunnel'){result.tunnel=true;continue;}
    if(flag==='--offline'){result.tunnel=false;continue;}
    if(!['--port','--host','--data-dir','--assets','--migrations','--cloudflared'].includes(flag))throw new Error(`Unknown option ${flag}. Run with --help for instructions.`);
    const value=args[++index];if(!value||value.startsWith('--'))throw new Error(`A value is required for ${flag}.`);
    if(flag==='--port'){result.port=Number(value);if(!Number.isInteger(result.port)||result.port<1||result.port>65535)throw new Error('Choose a port from 1 to 65535.');}
    else if(flag==='--host'){if(!/^[a-zA-Z0-9:.%-]+$/.test(value))throw new Error('Invalid server host.');result.host=value;}
    else if(flag==='--data-dir')result.dataDir=resolve(value);
    else if(flag==='--assets')result.assets=resolve(value);
    else if(flag==='--cloudflared')result.cloudflared=resolve(value);
    else result.migrations=resolve(value);
  }
  return result;
}

function embeddedJson<T>(name:string,filename:string|undefined):T{
  if(isSea())return JSON.parse(getAsset(name,'utf8')) as T;
  if(!filename)throw new Error(`Developer mode needs --${name==='web-assets.json'?'assets':'migrations'} FILE. The standalone EXE already contains these files.`);
  return JSON.parse(readFileSync(filename,'utf8')) as T;
}
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

async function main(){
  const config=options();if(!config)return;
  const assets=embeddedJson<Record<string,Asset>>('web-assets.json',config.assets);
  const migrations=embeddedJson<Migration[]>('migrations.json',config.migrations);
  if(!assets['/index.html'])throw new Error('The embedded game page is missing. Rebuild the server EXE.');
  const staticAssets=new Map(Object.entries(assets).map(([path,asset])=>[path,{bytes:Buffer.from(asset.content,'base64'),mime:asset.mime}]));
  const databaseFile=join(config.dataDir,'classroom.sqlite');
  const database=new LocalDatabase(databaseFile,migrations);setLocalDatabase(database);
  let publicOrigin:string|null=null;
  let tunnelState:'off'|'starting'|'ready'|'failed'=config.tunnel?'starting':'off';
  let tunnelError='';
  let tunnelProcess:ReturnType<typeof startQuickTunnel>|undefined;
  let tunnelServer:ReturnType<typeof createServer>|undefined;
  const privateAddress=(address:string)=>/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(address);
  const ipv4=Object.values(networkInterfaces()).flat().filter(item=>item&&!item.internal&&item.family==='IPv4').map(item=>item!.address).sort((a,b)=>Number(privateAddress(b))-Number(privateAddress(a)));
  const allowedHosts=new Set(['localhost','127.0.0.1','[::1]',hostname().toLowerCase(),...ipv4]);
  if(config.host!=='0.0.0.0'&&config.host!=='::')allowedHosts.add(config.host.toLowerCase());
  const wildcard=config.host==='0.0.0.0'||config.host==='::';
  const shareHost=wildcard?ipv4[0]??'127.0.0.1':config.host;
  const formattedShareHost=shareHost.includes(':')&&!shareHost.startsWith('[')?`[${shareHost}]`:shareHost;
  const lanOrigin=`http://${formattedShareHost}:${config.port}`;
  const handleRequest=async(request:IncomingMessage,response:ServerResponse,viaTunnel=false)=>{
    try{
      const host=request.headers.host;if(!host||!/^[a-zA-Z0-9.[\]:-]+$/.test(host))throw new HttpError(400,'Invalid server address.');
      const requestPath=request.url??'/';
      if(!requestPath.startsWith('/')||requestPath.startsWith('//'))throw new HttpError(400,'Use a relative game address.');
      const url=new URL(requestPath,`${viaTunnel?'https':'http'}://${host}`);
      if(viaTunnel){
        if(!loopbackSocket(request.socket.remoteAddress))throw new HttpError(403,'Use the student HTTPS link.');
        if(!publicOrigin||tunnelState!=='ready')throw new HttpError(503,'The public student link is not connected yet.');
        if(url.origin!==publicOrigin)throw new HttpError(403,'Open the server using its displayed student HTTPS link.');
      }else if(!allowedHosts.has(url.hostname.toLowerCase()))throw new HttpError(403,'Open the server using its displayed classroom network link.');
      const isLocal=!viaTunnel&&loopbackSocket(request.socket.remoteAddress)&&loopbackHost(url.hostname.toLowerCase());
      const teacherArea=url.pathname==='/teacher'||url.pathname.startsWith('/teacher/');
      if(teacherArea&&!isLocal)throw new HttpError(403,'Teacher controls are available only on the server computer.');
      const teacherApi=url.pathname==='/teacher/api/game';
      if(teacherApi&&(request.headers['sec-fetch-site']==='cross-site'||request.headers.origin&&request.headers.origin!==url.origin))throw new HttpError(403,'Open the teacher dashboard on this computer to make changes.');
      if(url.pathname==='/api/server-info'&&request.method==='GET'){
        sendJson(response,200,{shareOrigin:config.tunnel?publicOrigin:lanOrigin,localOrigin:`http://127.0.0.1:${config.port}`,lanOrigin:viaTunnel?null:lanOrigin,tunnel:{state:tunnelState,...(tunnelError?{error:tunnelError}:{})}});return;
      }
      if(url.pathname==='/health'&&request.method==='GET'){sendJson(response,200,{ok:true,app:'DeGolyer ES Sudoku Server'});return;}
      if((url.pathname==='/teacher'||url.pathname==='/teacher/')&&request.method==='POST'){
        request.resume();redirect(response,'/teacher');return;
      }
      if(url.pathname==='/signin-with-chatgpt'||url.pathname==='/signout-with-chatgpt'){
        if(!isLocal)throw new HttpError(403,'Teacher controls are available only on the server computer.');
        if(request.method!=='GET')throw new HttpError(405,'Open the teacher dashboard directly.');
        redirect(response,url.pathname==='/signin-with-chatgpt'?'/teacher':'/');return;
      }
      if(url.pathname==='/api/game'||teacherApi){
        if(request.method!=='GET'&&request.method!=='POST')throw new HttpError(405,'This game action is not supported.');
        const headers=new Headers();
        for(const [name,value] of Object.entries(request.headers)){
          if(value===undefined||(teacherApi&&name==='cookie')||name.startsWith('oai-')||name.startsWith('x-forwarded-')||['forwarded','connection','transfer-encoding','content-length','cf-connecting-ip','x-sudoku-public-ingress'].includes(name))continue;
          if(Array.isArray(value))headers.set(name,value.join(', '));else headers.set(name,value);
        }
        const clientIp=request.headers['cf-connecting-ip'];
        headers.set('cf-connecting-ip',viaTunnel&&typeof clientIp==='string'&&isIP(clientIp)?clientIp:request.socket.remoteAddress??'local');
        if(viaTunnel)headers.set('x-sudoku-public-ingress','1');
        const payload=request.method==='POST'?await body(request):undefined;
        const gameRequest=new Request(url,{method:request.method,headers,...(payload?{body:new Uint8Array(payload)}:{})});
        const result=await withLocalIdentity(teacherApi?localTeacher:null,()=>request.method==='GET'?GET(gameRequest):POST(gameRequest));
        commonHeaders(response);response.statusCode=result.status;
        result.headers.forEach((value,name)=>{if(name.toLowerCase()!=='set-cookie')response.setHeader(name,value);});
        const cookies=result.headers.getSetCookie();if(cookies.length)response.setHeader('Set-Cookie',cookies);
        response.end(Buffer.from(await result.arrayBuffer()));return;
      }
      if(request.method!=='GET'&&request.method!=='HEAD')throw new HttpError(405,'This page does not accept changes.');
      let path:string;try{path=decodeURIComponent(url.pathname==='/teacher'||url.pathname==='/teacher/'?'/index.html':url.pathname);}catch{throw new HttpError(400,'Invalid page address.');}
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
  };
  const server=createServer((request,response)=>void handleRequest(request,response));
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  try{await new Promise<void>((resolveListen,reject)=>{server.once('error',reject);server.listen(config.port,config.host,()=>{server.removeListener('error',reject);resolveListen();});});}
  catch(error){database.close();if((error as NodeJS.ErrnoException).code==='EADDRINUSE')throw new Error(`Port ${config.port} is already in use. The Sudoku server may already be running. Open http://127.0.0.1:${config.port}/ or run with --port 8788.`);throw error;}
  const teacherUrl=`http://127.0.0.1:${config.port}/teacher`;
  console.log('\nDeGolyer ES Sudoku Server\n=========================');
  console.log(`Local game: http://127.0.0.1:${config.port}/`);
  console.log(`Teacher dashboard (no login): ${teacherUrl}`);
  if(config.host==='0.0.0.0'||config.host==='::'){
    for(const address of ipv4)console.log(`Student network: http://${address}:${config.port}/`);
    if(!ipv4.length)console.log('No active network address found. Connect this computer to the classroom network and restart to see its student link.');
  }
  console.log(`Student database: ${databaseFile}`);
  console.log('Keep this window open while students play. Press Ctrl+C to stop.\n');
  let closing=false;
  if(config.tunnel){
    console.log('Connecting Cloudflare Tunnel. The student HTTPS link will appear when it is ready.');
    tunnelServer=createServer((request,response)=>void handleRequest(request,response,true));
    tunnelServer.requestTimeout=15000;tunnelServer.headersTimeout=10000;tunnelServer.keepAliveTimeout=5000;
    try{
      await new Promise<void>((resolveListen,reject)=>{tunnelServer!.once('error',reject);tunnelServer!.listen(0,'127.0.0.1',()=>{tunnelServer!.removeListener('error',reject);resolveListen();});});
      const address=tunnelServer.address();if(!address||typeof address==='string')throw new Error('Could not create the student tunnel listener.');
      const tunnelExecutable=resolveEmbeddedCloudflared(config.dataDir,config.cloudflared??(!isSea()?join(process.cwd(),'cloudflared.exe'):undefined));
      tunnelProcess=startQuickTunnel({executable:tunnelExecutable,origin:`http://127.0.0.1:${address.port}`,onOrigin:origin=>{
        if(closing)return;publicOrigin=origin;tunnelState='ready';tunnelError='';
        console.log(`\nStudent HTTPS link: ${origin}/\nCloudflare Tunnel is connected. Share classroom now uses this link.\nThis temporary link changes when you restart online play.\n`);
      },onFailure:message=>{
        if(closing)return;publicOrigin=null;tunnelState='failed';tunnelError=message;
        console.error(`\nCloudflare Tunnel is unavailable: ${message}\nLocal network play still works at ${lanOrigin}/\n`);
        tunnelServer?.close();tunnelServer?.closeIdleConnections();tunnelServer?.closeAllConnections();
      }});
    }catch(error){
      tunnelState='failed';tunnelError=error instanceof Error?error.message:'Could not start the student tunnel.';
      console.error(`Cloudflare Tunnel is unavailable: ${tunnelError}`);tunnelServer?.close();
    }
  }
  if(!config.noOpen&&process.platform==='win32')spawn('explorer.exe',[teacherUrl],{stdio:'ignore',windowsHide:true}).on('error',()=>console.log('Open the teacher link above in your browser.'));
  const stop=()=>{
    if(closing)return;closing=true;console.log('\nSaving classroom data and stopping the server…');
    const closeServer=(target:ReturnType<typeof createServer>)=>new Promise<void>(resolveClose=>{target.close(()=>resolveClose());target.closeIdleConnections();setTimeout(()=>target.closeAllConnections(),3000).unref();});
    void Promise.all([closeServer(server),...(tunnelServer?[closeServer(tunnelServer)]:[]),...(tunnelProcess?[tunnelProcess.stop()]:[])]).then(()=>{database.close();process.exitCode=0;}).catch(error=>{console.error('Could not stop cleanly:',error instanceof Error?error.message:String(error));process.exitCode=1;});
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

void main().catch(error=>{
  console.error(`\nCould not start DeGolyer ES Sudoku Server: ${error instanceof Error?error.message:String(error)}\n`);
  process.exitCode=1;
  if(process.stdin.isTTY&&!process.argv.includes('--no-open')){console.log('Press Enter to close this window.');process.stdin.resume();process.stdin.once('data',()=>process.stdin.pause());}
});
