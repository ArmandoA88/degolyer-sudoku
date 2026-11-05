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
const retiredClassUi=/\b(?:classroom|class)\s+code\b|[?&]class=/i;
const registrationPayload=/(?:\baction|["'\x60]action["'\x60])\s*:\s*["'\x60]register["'\x60]/;
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
let mountedCleanup=false,legacyReadOrWrite=false,emptyState,rosterPayloads=0,loginPayloads=0,registerPayloads=0;
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
  if(ts.isJsxText(node))assert.equal(retiredClassUi.test(node.getText(ast)),false,'The student UI must not display a retired class-code prompt or copy label.');
  if(ts.isJsxAttribute(node)&&node.initializer&&ts.isStringLiteral(node.initializer)){
    assert.equal(retiredClassUi.test(node.initializer.text),false,'Visible UI attributes must not expose class-code controls.');
    assert.equal(/^(?:classCode|classroomCode)$/i.test(node.initializer.text),false,'The student UI must not have a class-code form field.');
  }
  if(ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))assert.equal(/[?&]class=/.test(node.text),false,'Shared student URLs must not include a class selector.');
  if(ts.isObjectLiteralExpression(node)){
    const properties=node.properties.filter(ts.isPropertyAssignment),action=properties.find(property=>property.name.getText(ast).replace(/^['"]|['"]$/g,'')==='action');
    if(action&&ts.isStringLiteralLike(action.initializer)&&['roster','login','register'].includes(action.initializer.text)){
      const names=node.properties.filter(property=>ts.isPropertyAssignment(property)||ts.isShorthandPropertyAssignment(property)).map(property=>property.name.getText(ast).replace(/^['"]|['"]$/g,''));
      assert.equal(names.includes('classCode'),false,'Student '+action.initializer.text+' must not require a class code.');
      if(action.initializer.text==='roster')rosterPayloads++;else if(action.initializer.text==='login')loginPayloads++;else{registerPayloads++;for(const field of ['name','pin','confirmPin'])assert.ok(names.includes(field),'Student registration must submit '+field+'.');}
    }
  }
  if(ts.isCallExpression(node)){
    if(ts.isIdentifier(node.expression)&&node.expression.text==='useEffect'&&node.arguments.length>=2&&ts.isArrayLiteralExpression(node.arguments[1])&&node.arguments[1].elements.length===0&&containsCleanup(node.arguments[0]))mountedCleanup=true;
    if(ts.isPropertyAccessExpression(node.expression)&&['getItem','setItem'].includes(node.expression.name.text)&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])&&node.arguments[0].text==='degolyer-sudoku-demo-v1')legacyReadOrWrite=true;
  }
  ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(mountedCleanup,'The real student page must run the legacy-data cleanup on initial mount.');
assert.equal(legacyReadOrWrite,false,'The page must not load or save the retired demo profile.');
assert.ok(rosterPayloads>0&&loginPayloads>0,'The UI must load the one roster and submit selected-name/PIN login.');
assert.ok(registerPayloads>0,'The UI must provide a real student name-registration form.');
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
for(const file of clientFiles){const contents=readFileSync(file,'utf8');assert.equal(retiredContent.test(contents),false,'Built client still contains retired sample data: '+path.relative(clientDir,file));assert.equal(retiredClassUi.test(contents),false,'Built client still contains class-code prompts or shared query selectors: '+path.relative(clientDir,file));}
const registrationAsset=clientFiles.find(file=>file.endsWith('.js')&&registrationPayload.test(readFileSync(file,'utf8')));
assert.ok(registrationAsset,'The built browser client must include the real name/PIN self-registration request.');
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
  if(state.classroom)assert.equal('code' in state.classroom,false,'Public classroom metadata must omit the retired code.');
  assert.equal(retiredContent.test(JSON.stringify(state)),false);
  const rosterResponse=await fetch(new URL('/api/game',origin),{method:'POST',headers:{'content-type':'application/json',origin:origin.origin},body:JSON.stringify({action:'roster'}),signal:AbortSignal.timeout(10000)});
  assert.equal(rosterResponse.status,200,'The public one-classroom name picker must not require a class code.');
  const roster=await rosterResponse.json();assert.deepEqual(Object.keys(roster).sort(),['classroom','students']);assert.ok(Array.isArray(roster.students));
  if(roster.classroom)assert.deepEqual(Object.keys(roster.classroom),['name']);else assert.deepEqual(roster.students,[],'An unconfigured classroom must return an empty name picker.');
  for(const student of roster.students)assert.deepEqual(Object.keys(student).sort(),['avatar','id','name'],'The public name picker must not expose PINs, scores, internal codes, or saved boards.');
  const page=await fetch(origin,{signal:AbortSignal.timeout(10000)});assert.equal(page.status,200);const html=await page.text();
  assert.equal(retiredContent.test(html),false);assert.equal(retiredClassUi.test(html),false);
  const assets=new Set([...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match=>new URL(match[1],origin).href).filter(url=>new URL(url).origin===origin.origin));
  assert.ok(assets.size>0,'The published page must reference its browser assets.');
  for(const asset of assets){const result=await fetch(asset,{signal:AbortSignal.timeout(10000)});assert.equal(result.status,200);const contents=await result.text();assert.equal(retiredContent.test(contents),false,'Published asset still contains retired classroom samples.');assert.equal(retiredClassUi.test(contents),false,'Published asset still contains retired class-code controls.');}
  const registrationUrl=new URL('/'+path.relative(clientDir,registrationAsset).split(path.sep).join('/'),origin);
  const registrationResult=await fetch(registrationUrl,{signal:AbortSignal.timeout(10000)});assert.equal(registrationResult.status,200,'The matching self-registration browser bundle must be published.');assert.ok(registrationPayload.test(await registrationResult.text()),'The published client must offer the tested name/PIN registration flow.');
  pass('public Site has a code-free minimal name picker, no sample class, and no anonymous student stats');
}
console.log('Real-student readiness audit passed.');
