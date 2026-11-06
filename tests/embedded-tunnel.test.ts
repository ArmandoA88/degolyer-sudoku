import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,statSync,utimesSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {materializeCloudflared,resolveEmbeddedCloudflared} from '../standalone/embedded-tunnel.ts';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const outputs=join(project,'outputs');mkdirSync(outputs,{recursive:true});
const fixture=()=>mkdtempSync(join(outputs,'embedded tunnel '));
const binary=Buffer.from('MZ\u0000trusted embedded fixture binary\u0000','utf8');
const metadata={version:'2026.10.7',sha256:createHash('sha256').update(binary).digest('hex')};

test('embedded tunnel extracts a verified Windows binary inside the classroom data folder',()=>{
  const data=join(fixture(),'Classroom data');
  const executable=materializeCloudflared(data,binary,metadata);
  assert.equal(isAbsolute(executable),true);
  assert.equal(dirname(executable),join(data,'runtime'));
  assert.match(executable,/cloudflared-2026\.10\.7-[a-f0-9]{16}\.exe$/);
  assert.deepEqual(readFileSync(executable),binary);
  assert.equal(lstatSync(executable).isFile(),true);
  assert.deepEqual(readdirSync(dirname(executable)),[executable.slice(dirname(executable).length+1)],'The temporary extraction file must be removed.');
});

test('a valid cache is reused without rewriting the running executable',()=>{
  const data=fixture();const executable=materializeCloudflared(data,binary,metadata);
  const stamp=new Date('2020-01-01T00:00:00Z');utimesSync(executable,stamp,stamp);
  const before=statSync(executable).mtimeMs;
  assert.equal(materializeCloudflared(data,binary,metadata),executable);
  assert.equal(statSync(executable).mtimeMs,before,'A valid cached executable must not be replaced.');
});

test('a modified cached binary is replaced before it can be used',()=>{
  const data=fixture();const executable=materializeCloudflared(data,binary,metadata);
  writeFileSync(executable,Buffer.alloc(binary.length,0x78));
  assert.equal(materializeCloudflared(data,binary,metadata),executable);
  assert.deepEqual(readFileSync(executable),binary);
  assert.equal(readdirSync(dirname(executable)).length,1,'Repair must not leave temporary files.');
});

test('tampered or non-executable embedded bytes are rejected before extraction',()=>{
  for(const bytes of [Buffer.from('MZincorrect'),Buffer.from('not a Windows binary')]){
    const data=join(fixture(),'new classroom');
    const release=bytes[0]===0x4d?metadata:{...metadata,sha256:createHash('sha256').update(bytes).digest('hex')};
    assert.throws(()=>materializeCloudflared(data,bytes,release),/checksum/);
    assert.equal(existsSync(data),false,'Invalid embedded bytes must not write a cache.');
  }
});

test('unsafe package metadata cannot choose another extraction path',()=>{
  for(const value of [null,{},[],{...metadata,version:'../../outside'},{...metadata,version:'2026.10.7.exe'},{...metadata,sha256:'../outside'},{...metadata,sha256:23}]){
    const data=join(fixture(),'new classroom');
    assert.throws(()=>materializeCloudflared(data,binary,value),/metadata is invalid/);
    assert.equal(existsSync(data),false);
  }
});

test('an executable override must be absolute and works outside the packaged EXE',()=>{
  const override=join(fixture(),'chosen cloudflared.exe');
  assert.equal(resolveEmbeddedCloudflared('unused',override),override);
  assert.throws(()=>resolveEmbeddedCloudflared('unused','relative.exe'),/full path/);
  assert.throws(()=>resolveEmbeddedCloudflared('unused'),/Developer mode needs/);
});

test('a non-file cache target is rejected without leaving extraction debris',()=>{
  const data=fixture();const executable=materializeCloudflared(data,binary,metadata);
  // Use a second pinned version to create a target directory without replacing files.
  const other={...metadata,version:'2026.10.8'};
  const target=join(dirname(executable),`cloudflared-${other.version}-${other.sha256.slice(0,16)}.exe`);
  mkdirSync(target);
  assert.throws(()=>materializeCloudflared(data,binary,other),/regular file/);
  assert.equal(readdirSync(dirname(executable)).some(file=>file.endsWith('.tmp')),false);
});

test('concurrent processes can safely reuse one verified extraction',async()=>{
  const data=fixture();const moduleUrl=new URL('../standalone/embedded-tunnel.ts',import.meta.url).href;
  const script=`import {materializeCloudflared} from ${JSON.stringify(moduleUrl)}; const p=materializeCloudflared(${JSON.stringify(data)},Buffer.from(${JSON.stringify(binary.toString('base64'))},'base64'),${JSON.stringify(metadata)}); process.stdout.write(p);`;
  const children=Array.from({length:4},()=>new Promise<string>((resolveChild,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','--eval',script],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);
    child.once('exit',code=>code===0?resolveChild(stdout):reject(new Error('Extraction child failed: '+stderr)));
  }));
  const paths=await Promise.all(children);assert.equal(new Set(paths).size,1);
  assert.deepEqual(readFileSync(paths[0]),binary);
  assert.equal(readdirSync(dirname(paths[0])).some(file=>file.endsWith('.tmp')),false);
});
