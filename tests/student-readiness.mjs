/** Read-only audit of the real-student UI and optional deployed public assets.
 * Run after the UI build: node tests/student-readiness.mjs [--origin https://SITE]
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pageFile=path.join(project,'app','page.tsx'),uiFile=path.join(project,'lib','ui.ts');
const source=readFileSync(pageFile,'utf8');
const retiredContent=/Maya R\.|Leo M\.|Sofia G\.|Ethan J\.|Isabella A\.|Noah T\.|Demo classroom|Example scores stay on this device|demoSolution|demoHistory/i;
const pass=message=>console.log('PASS '+message);

assert.ok(existsSync(uiFile),'Shared UI helpers must be separated from retired sample data.');
assert.equal(existsSync(path.join(project,'lib','demo.ts')),false,'The retired seeded classroom module must be removed.');
const bundled=await build({entryPoints:[uiFile],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const ui=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
assert.equal(typeof ui.clearLegacyDemoStorage,'function','Legacy cleanup must be an executable, tested helper.');
const remembered=new Map([['degolyer-sudoku-demo-v1','retired fixture'],['degolyer-sudoku-login-v1','real classroom selection'],['other-preference','keep']]);
const removed=[];
ui.clearLegacyDemoStorage({removeItem(key){removed.push(key);remembered.delete(key);}});
assert.deepEqual(removed,['degolyer-sudoku-demo-v1']);
assert.equal(remembered.has('degolyer-sudoku-demo-v1'),false);
assert.equal(remembered.get('degolyer-sudoku-login-v1'),'real classroom selection');
assert.equal(remembered.get('other-preference'),'keep');
pass('retired browser sample data is cleared while real classroom selection and unrelated preferences remain');

const ast=ts.createSourceFile(pageFile,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function containsCleanup(node){
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='clearLegacyDemoStorage')return true;
  let found=false;ts.forEachChild(node,child=>{if(containsCleanup(child))found=true;});return found;
}
let mountedCleanup=false,legacyReadOrWrite=false,emptyState;
function literal(node){
  if(node.kind===ts.SyntaxKind.NullKeyword)return null;
  if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
  if(node.kind===ts.SyntaxKind.TrueKeyword)return true;
  if(ts.isArrayLiteralExpression(node))return node.elements.map(literal);
  if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.map(property=>{
    assert.ok(ts.isPropertyAssignment(property),'Initial state must contain only explicit data fields.');
    return [property.name.getText(ast).replace(/^['"]|['"]$/g,''),literal(property.initializer)];
  }));
  throw new Error('Initial student fallback state must not call a generator or fabricate data.');
}
function visit(node){
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='EMPTY_STATE'&&node.initializer)emptyState=literal(node.initializer);
  if(ts.isCallExpression(node)){
    if(ts.isIdentifier(node.expression)&&node.expression.text==='useEffect'&&node.arguments.length>=2&&ts.isArrayLiteralExpression(node.arguments[1])&&node.arguments[1].elements.length===0&&containsCleanup(node.arguments[0]))mountedCleanup=true;
    if(ts.isPropertyAccessExpression(node.expression)&&['getItem','setItem'].includes(node.expression.name.text)&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])&&node.arguments[0].text==='degolyer-sudoku-demo-v1')legacyReadOrWrite=true;
  }
  ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(mountedCleanup,'The real student page must run the legacy-data cleanup on initial mount.');
assert.equal(legacyReadOrWrite,false,'The page must not load or save the retired demo profile.');
assert.equal(retiredContent.test(source),false,'Student-facing source must not include the retired named examples or fake classroom state.');
assert.ok(emptyState,'The browser must have an explicit empty fallback before authenticating.');
assert.equal(emptyState.user,null);assert.equal(emptyState.classroom,null);assert.equal(emptyState.student,null);assert.equal(emptyState.game,null);assert.equal(emptyState.isTeacher,false);
for(const key of ['records','leaderboard','redemptions'])assert.deepEqual(emptyState[key],[],'Unauthenticated UI fallback must have no '+key+'.');
pass('initial page setup clears legacy sample storage and does not reload a fake student profile');

function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const clientDir=path.join(project,'dist','client');
assert.ok(existsSync(clientDir),'Build the hosted client before running the readiness audit.');
const clientFiles=files(clientDir).filter(file=>/\.(?:js|css|html)$/.test(file));
assert.ok(clientFiles.some(file=>file.endsWith('.js')),'A built browser client must exist.');
for(const file of clientFiles)assert.equal(retiredContent.test(readFileSync(file,'utf8')),false,'Built client still contains retired sample data: '+path.relative(clientDir,file));
pass('all built browser JavaScript, CSS, and HTML omit seeded names, example scores, and demo-state payloads');

const originFlag=process.argv.indexOf('--origin');
if(originFlag>=0){
  assert.ok(process.argv[originFlag+1],'Supply a Site origin after --origin.');
  const origin=new URL(process.argv[originFlag+1]);
  assert.ok(origin.protocol==='https:'||(['localhost','127.0.0.1','[::1]'].includes(origin.hostname)&&origin.protocol==='http:'),'Audit only HTTPS Sites or HTTP localhost.');
  const response=await fetch(new URL('/api/game',origin),{signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200);const state=await response.json();
  assert.equal(state.user,null);assert.equal(state.isTeacher,false);assert.equal(state.student,null);assert.equal(state.game,null);
  assert.deepEqual(state.records,[]);assert.deepEqual(state.redemptions,[]);assert.equal(state.dashboard,undefined);
  assert.equal(retiredContent.test(JSON.stringify(state)),false);
  const page=await fetch(origin,{signal:AbortSignal.timeout(10000)});assert.equal(page.status,200);const html=await page.text();
  assert.equal(retiredContent.test(html),false);
  const assets=new Set([...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match=>new URL(match[1],origin).href).filter(url=>new URL(url).origin===origin.origin));
  assert.ok(assets.size>0,'The published page must reference its browser assets.');
  for(const asset of assets){const result=await fetch(asset,{signal:AbortSignal.timeout(10000)});assert.equal(result.status,200);assert.equal(retiredContent.test(await result.text()),false,'Published asset still contains retired classroom samples.');}
  pass('public Site landing page/assets contain no sample class and anonymous visitors receive no student stats');
}
console.log('Real-student readiness audit passed.');
