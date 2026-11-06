import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const sourceDir=path.dirname(fileURLToPath(import.meta.url));
const workspaceDir=path.dirname(path.dirname(sourceDir));
const release=JSON.parse(await readFile(path.join(sourceDir,'cloudflared-release.json'),'utf8'));
const binary=path.join(workspaceDir,'cloudflared.exe');
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
let existing;
try{existing=await readFile(binary);}catch(error){if(error.code!=='ENOENT')throw error;}
if(!existing||checksum(existing)!==release.sha256){
  console.log('Downloading official cloudflared '+release.version+' for Windows x64...');
  const response=await fetch(release.url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error('The official cloudflared download failed: HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(checksum(bytes)!==release.sha256)throw new Error('The cloudflared checksum does not match the pinned official release. The server was not changed.');
  await writeFile(binary,bytes);
}
const license=path.join(sourceDir,'CLOUDFLARED-LICENSE.txt');
try{await readFile(license);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const response=await fetch(release.licenseUrl,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('The official cloudflared license download failed: HTTP '+response.status);
  await writeFile(license,await response.text());
}
await copyFile(license,path.join(workspaceDir,'CLOUDFLARED-LICENSE.txt'));
console.log('Verified cloudflared '+release.version+': '+binary);
