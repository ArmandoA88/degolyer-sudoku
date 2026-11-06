import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {existsSync,readFileSync} from 'node:fs';
import {PassThrough} from 'node:stream';
import {type ChildProcess,type SpawnOptions, type spawn} from 'node:child_process';
import {resolve} from 'node:path';
import test from 'node:test';
import {startQuickTunnel,TunnelLogParser} from '../standalone/tunnel.ts';

test('tunnel logs require a complete exact Cloudflare hostname and a registered connection',()=>{
  const parser=new TunnelLogParser();
  assert.deepEqual(parser.push('| https://yellow-block.trycloud'),{origin:null,connected:false});
  assert.deepEqual(parser.push('flare.com |\n'),{origin:'https://yellow-block.trycloudflare.com',connected:false});
  assert.deepEqual(parser.push('INF Registered tunnel connection connIndex=0\n'),{origin:'https://yellow-block.trycloudflare.com',connected:true});
});

test('hostname parsing rejects lookalike hosts, credentials, ports, and unfinished lines',()=>{
  for(const address of ['http://yellow-block.trycloudflare.com','https://yellow-block.trycloudflare.com.evil.test','https://yellow-block.trycloudflare.com:8443','https://yellow-block.trycloudflare.com@evil.test','https://-bad.trycloudflare.com','https://bad-.trycloudflare.com','https://evil.test']){
    assert.equal(new TunnelLogParser().push(address+'\n').origin,null,address);
  }
  const parser=new TunnelLogParser();
  assert.equal(parser.push('https://looks-valid.trycloudflare.com').origin,null);
  assert.equal(parser.push('.evil.test\n').origin,null,'A hostname split at .com must not bypass the suffix check.');
});

test('parser keeps stdout/stderr fragments separate and survives noisy bounded logs',()=>{
  const parser=new TunnelLogParser();
  parser.push('https://yellow-block.trycloudflare','stdout');
  parser.push('.com\nRegistered tunnel connection\n','stderr');
  assert.equal(parser.push('\n','stdout').origin,null);
  assert.equal(parser.push('x'.repeat(100000)+'\nhttps://new-block.trycloudflare.com\n').origin,'https://new-block.trycloudflare.com');
});

class FakeChild extends EventEmitter {
  stdout=new PassThrough();
  stderr=new PassThrough();
  exitCode:number|null=null;
  signalCode:NodeJS.Signals|null=null;
  signals:NodeJS.Signals[]=[];
  kill(signal:NodeJS.Signals='SIGTERM'){
    this.signals.push(signal);this.signalCode=signal;
    queueMicrotask(()=>this.emit('exit',null,signal));return true;
  }
}
function fixture(){
  const child=new FakeChild(),origins:string[]=[],failures:string[]=[];
  let invocation:{file:string;args:readonly string[];options:SpawnOptions}|undefined;
  const spawnFake=((file:string,args:readonly string[],options:SpawnOptions)=>{invocation={file,args,options};return child as unknown as ChildProcess;}) as typeof spawn;
  const options={executable:resolve('cloudflared.exe'),origin:'http://127.0.0.1:43210',onOrigin:(origin:string)=>origins.push(origin),onFailure:(message:string)=>failures.push(message)};
  return {child,origins,failures,options,spawnFake,invocation:()=>invocation};
}

test('helper spawns a hidden shell-free child and announces ready only after connection',async()=>{
  const f=fixture(),handle=startQuickTunnel(f.options,{spawn:f.spawnFake});
  const called=f.invocation()!;
  assert.equal(called.file,f.options.executable);assert.equal(called.options.shell,false);assert.equal(called.options.windowsHide,true);assert.deepEqual(called.options.stdio,['ignore','pipe','pipe']);
  assert.deepEqual(called.args.slice(0,2),['tunnel','--config']);assert.equal(readFileSync(called.args[2],'utf8'),'{}\n');
  assert.deepEqual(called.args.slice(3),['--no-autoupdate','--url','http://127.0.0.1:43210']);
  assert.equal(Object.keys(called.options.env!).some(key=>/^TUNNEL_/i.test(key)),false,'Ambient tunnel options must not redirect the origin.');
  f.child.stderr.write('https://yellow-block.trycloudflare.com\n');assert.deepEqual(f.origins,[]);
  f.child.stderr.write('INF Registered tunnel connection\n');assert.deepEqual(f.origins,['https://yellow-block.trycloudflare.com']);
  f.child.stderr.write('INF Registered tunnel connection\n');assert.equal(f.origins.length,1);
  await handle.stop();await handle.stop();assert.deepEqual(f.child.signals,['SIGTERM']);assert.deepEqual(f.failures,[]);assert.equal(existsSync(called.args[2]),false,'The isolated config must be removed on stop.');
});

test('startup failure and unexpected exit invalidate the public link exactly once',async()=>{
  const f=fixture(),handle=startQuickTunnel(f.options,{spawn:f.spawnFake});
  f.child.emit('error',new Error('private operating system details'));
  await handle.stop();
  assert.equal(f.failures.length,1);assert.match(f.failures[0],/could not start/);assert.equal(f.failures[0].includes('private'),false);
  const next=fixture(),nextHandle=startQuickTunnel(next.options,{spawn:next.spawnFake});
  next.child.stderr.write('Registered tunnel connection\nhttps://yellow-block.trycloudflare.com\n');
  next.child.exitCode=1;next.child.emit('exit',1,null);
  assert.equal(next.failures.length,1);assert.match(next.failures[0],/public classroom link stopped/);
  await nextHandle.stop();
});

test('startup timeout stops the child without publishing an unconnected hostname',async()=>{
  const f=fixture(),handle=startQuickTunnel(f.options,{spawn:f.spawnFake,timeoutMs:10});
  f.child.stderr.write('https://yellow-block.trycloudflare.com\n');
  await new Promise(resolveWait=>setTimeout(resolveWait,30));
  assert.deepEqual(f.origins,[]);assert.equal(f.failures.length,1);assert.match(f.failures[0],/did not connect in time/);assert.deepEqual(f.child.signals,['SIGTERM']);
  await handle.stop();
});

test('helper refuses non-loopback origins and shell-resolved executables',()=>{
  const f=fixture();
  for(const origin of ['https://127.0.0.1:8787','http://example.com:8787','http://127.0.0.1','http://127.0.0.1:8787/private','http://user:secret@127.0.0.1:8787'])assert.throws(()=>startQuickTunnel({...f.options,origin},{spawn:f.spawnFake}),/loopback/);
  assert.throws(()=>startQuickTunnel({...f.options,executable:'cloudflared.exe'},{spawn:f.spawnFake}),/full path/);
  assert.equal(f.invocation(),undefined);
});
