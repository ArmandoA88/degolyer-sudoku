import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute,join} from 'node:path';

export type QuickTunnelOptions={
  executable:string;
  origin:string;
  onOrigin:(origin:string)=>void;
  onFailure:(message:string)=>void;
};
export type QuickTunnelHandle={stop:()=>Promise<void>};
type Dependencies={spawn?:typeof spawn;timeoutMs?:number;shutdownMs?:number};

/** Only complete, bounded log lines are inspected, keeping split hostnames safe. */
export class TunnelLogParser {
  private tails=new Map<string,string>();
  private origin:string|null=null;
  private connected=false;

  push(chunk:string,stream='stderr'):{origin:string|null;connected:boolean}{
    const input=((this.tails.get(stream)??'')+chunk).slice(-16384);
    const lines=input.split(/\r?\n/);
    this.tails.set(stream,lines.pop()!.slice(-8192));
    for(const raw of lines){
      const line=raw.replace(/\u001b\[[0-9;]*m/g,'');
      const match=line.match(/https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com)(?=$|[\s/?!"'<>|)\]}])/);
      if(match&&!this.origin)this.origin='https://'+match[1];
      if(line.includes('Registered tunnel connection'))this.connected=true;
    }
    return {origin:this.origin,connected:this.connected};
  }
}

/** Starts an optional Quick Tunnel. The caller owns its loopback-only student server. */
export function startQuickTunnel(options:QuickTunnelOptions,dependencies:Dependencies={}):QuickTunnelHandle {
  if(!isAbsolute(options.executable))throw new Error('Use the full path to cloudflared.exe.');
  let origin:URL;
  try{origin=new URL(options.origin);}catch{throw new Error('The tunnel origin must be an HTTP loopback server.');}
  if(origin.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(origin.hostname)||!origin.port||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('The tunnel origin must be an HTTP loopback server with a port.');

  let child:ChildProcess;
  let stopped=false,failed=false,ready=false;
  let stopPromise:Promise<void>|undefined;
  let startupTimer:ReturnType<typeof setTimeout>|undefined;
  let configDirectory:string|undefined,configFile:string|undefined;
  const parser=new TunnelLogParser();
  const clearStartup=()=>{if(startupTimer){clearTimeout(startupTimer);startupTimer=undefined;}};
  const cleanConfig=()=>{
    if(configFile){try{unlinkSync(configFile);}catch{}configFile=undefined;}
    if(configDirectory){try{rmdirSync(configDirectory);}catch{}configDirectory=undefined;}
  };
  const exited=()=>child.exitCode!==null||child.signalCode!==null;
  const stop=():Promise<void>=>{
    if(stopPromise)return stopPromise;
    stopped=true;clearStartup();
    stopPromise=new Promise<void>(resolveStop=>{
      if(!child||exited()){cleanConfig();resolveStop();return;}
      let shutdownTimer:ReturnType<typeof setTimeout>|undefined;
      const finish=()=>{if(shutdownTimer)clearTimeout(shutdownTimer);child.removeListener('exit',finish);cleanConfig();resolveStop();};
      child.once('exit',finish);
      shutdownTimer=setTimeout(()=>{if(!exited())child.kill('SIGKILL');finish();},dependencies.shutdownMs??3000);
      try{child.kill('SIGTERM');}catch{finish();}
    });
    return stopPromise;
  };
  const fail=(message:string)=>{
    if(stopped||failed)return;
    failed=true;clearStartup();
    void stop();
    options.onFailure(message);
  };
  try{
    // An unrelated ~/.cloudflared/config.yml can override --url with its ingress.
    configDirectory=mkdtempSync(join(tmpdir(),'degolyer-sudoku-tunnel-'));
    configFile=join(configDirectory,'config.yml');
    writeFileSync(configFile,'{}\n',{flag:'wx',mode:0o600});
    const childEnvironment={...process.env};
    for(const key of Object.keys(childEnvironment))if(/^TUNNEL_/i.test(key))delete childEnvironment[key];
    child=(dependencies.spawn??spawn)(options.executable,['tunnel','--config',configFile,'--no-autoupdate','--url',origin.origin],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:childEnvironment});
  }catch{
    queueMicrotask(()=>fail('The bundled Cloudflare Tunnel could not start. Check that this app can write to SudokuData and run its tunnel helper. Local network play is still available.'));
    return {stop};
  }
  const inspect=(chunk:Buffer|string,stream:string)=>{
    if(stopped||failed)return;
    const status=parser.push(String(chunk),stream);
    if(!ready&&status.origin&&status.connected){ready=true;clearStartup();options.onOrigin(status.origin);}
  };
  child.stdout?.on('data',chunk=>inspect(chunk,'stdout'));
  child.stderr?.on('data',chunk=>inspect(chunk,'stderr'));
  child.once('error',()=>fail('The bundled Cloudflare Tunnel could not start. Check that this app can write to SudokuData and run its tunnel helper. Local network play is still available.'));
  child.once('exit',()=>fail(ready?'The public classroom link stopped. Restart the server to create a new link. Your saved student data is safe.':'Cloudflare Tunnel could not connect. Check the internet connection and try again. Local network play is still available.'));
  startupTimer=setTimeout(()=>fail('Cloudflare Tunnel did not connect in time. Check the internet connection and try again. Local network play is still available.'),dependencies.timeoutMs??45000);
  startupTimer.unref();
  return {stop};
}
