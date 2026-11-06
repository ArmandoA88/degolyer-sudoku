import {createHash,randomUUID} from 'node:crypto';
import {closeSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {getAsset,isSea} from 'node:sea';

export type CloudflaredRelease={version:string;sha256:string};
const checksum=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

function releaseMetadata(value:unknown):CloudflaredRelease {
  if(!value||typeof value!=='object')throw new Error('The embedded Cloudflare Tunnel metadata is invalid. Rebuild the Sudoku server.');
  const release=value as Partial<CloudflaredRelease>;
  if(typeof release.version!=='string'||!/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(release.version)||typeof release.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(release.sha256))throw new Error('The embedded Cloudflare Tunnel metadata is invalid. Rebuild the Sudoku server.');
  return {version:release.version,sha256:release.sha256.toLowerCase()};
}

function verifiedCache(filename:string,size:number,sha256:string):boolean {
  try{
    const file=lstatSync(filename);
    if(file.isSymbolicLink()||!file.isFile())throw new Error('The Cloudflare Tunnel cache path must be a regular file.');
    return file.size===size&&checksum(readFileSync(filename))===sha256;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}

/** Materializes only the pinned embedded binary; no adjacent installation is required. */
export function materializeCloudflared(dataDir:string,binary:Uint8Array,metadata:unknown):string {
  const release=releaseMetadata(metadata);
  if(binary.byteLength<2||binary[0]!==0x4d||binary[1]!==0x5a||checksum(binary)!==release.sha256)throw new Error('The embedded Cloudflare Tunnel binary failed its checksum. Rebuild the Sudoku server.');
  mkdirSync(resolve(dataDir),{recursive:true});
  const dataRoot=realpathSync(resolve(dataDir));
  const runtimeDir=join(dataRoot,'runtime');
  mkdirSync(runtimeDir,{recursive:true});
  const runtime=lstatSync(runtimeDir);
  if(runtime.isSymbolicLink()||!runtime.isDirectory()||realpathSync(runtimeDir).toLowerCase()!==runtimeDir.toLowerCase())throw new Error('The Cloudflare Tunnel runtime folder must stay inside the classroom data folder.');
  const executable=join(runtimeDir,`cloudflared-${release.version}-${release.sha256.slice(0,16)}.exe`);
  if(verifiedCache(executable,binary.byteLength,release.sha256))return executable;

  const temporary=join(runtimeDir,`.cloudflared-${randomUUID()}.tmp`);
  let descriptor:number|undefined;
  try{
    descriptor=openSync(temporary,'wx',0o700);
    writeFileSync(descriptor,binary);
    fsyncSync(descriptor);
    closeSync(descriptor);descriptor=undefined;
    if(!verifiedCache(temporary,binary.byteLength,release.sha256))throw new Error('The extracted Cloudflare Tunnel binary failed its checksum.');
    try{renameSync(temporary,executable);}catch(error){
      // Another server can have installed and started the same verified binary.
      // Windows may then refuse to replace its running executable.
      if(!verifiedCache(executable,binary.byteLength,release.sha256))throw error;
    }
    if(!verifiedCache(executable,binary.byteLength,release.sha256))throw new Error('The Cloudflare Tunnel cache could not be verified.');
    return executable;
  }finally{
    if(descriptor!==undefined)closeSync(descriptor);
    try{unlinkSync(temporary);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
}

export function resolveEmbeddedCloudflared(dataDir:string,explicitOverride?:string):string {
  if(explicitOverride!==undefined){
    if(!isAbsolute(explicitOverride))throw new Error('Use the full path for the Cloudflare Tunnel executable override.');
    return resolve(explicitOverride);
  }
  if(!isSea())throw new Error('Developer mode needs --cloudflared PATH. The standalone EXE contains its own Cloudflare Tunnel binary.');
  let metadata:unknown;
  try{metadata=JSON.parse(getAsset('cloudflared-release.json','utf8'));}catch{throw new Error('The embedded Cloudflare Tunnel metadata is missing or invalid. Rebuild the Sudoku server.');}
  return materializeCloudflared(dataDir,new Uint8Array(getAsset('cloudflared.exe')),metadata);
}
