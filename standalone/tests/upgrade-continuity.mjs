/** Verify a single-EXE upgrade against an online backup; never run against the source classroom. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

assert.equal(process.platform,'win32');
assert.ok(process.argv[2]&&process.argv[3],'Usage: node standalone/tests/upgrade-continuity.mjs SOURCE.sqlite UPDATE.exe');
const sourceFile=path.resolve(process.argv[2]),updateExe=path.resolve(process.argv[3]);
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const outputRoot=path.join(project,'outputs');mkdirSync(outputRoot,{recursive:true});
const fixture=mkdtempSync(path.join(outputRoot,'upgrade continuity '));
const snapshot=path.join(fixture,'classroom-online-backup.sqlite');
const source=new DatabaseSync(sourceFile,{readOnly:true});
try{await backup(source,snapshot,{rate:1024});}finally{source.close();}

function inspect(filename){
  const database=new DatabaseSync(filename,{readOnly:true});
  try{
    assert.equal(database.prepare('PRAGMA quick_check').get().quick_check,'ok','The classroom snapshot must be consistent.');
    const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
    const rows=Object.fromEntries(tables.map(name=>[name,database.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()]));
    const fingerprints=Object.fromEntries(Object.entries(rows).map(([name,data])=>[name,createHash('sha256').update(JSON.stringify(data)).digest('hex')]));
    return {rows,fingerprints};
  }finally{database.close();}
}
const before=inspect(snapshot);
const portable=path.join(fixture,'Updated portable server');mkdirSync(portable);
const dataDir=path.join(portable,'SudokuData');mkdirSync(dataDir);
const fixtureDatabase=path.join(dataDir,'classroom.sqlite');copyFileSync(snapshot,fixtureDatabase);
assert.notEqual(path.resolve(fixtureDatabase).toLowerCase(),sourceFile.toLowerCase());
const executable=path.join(portable,'Updated Sudoku.exe');copyFileSync(updateExe,executable);
const workingFolder=path.join(fixture,'Different working folder');mkdirSync(workingFolder);
const portServer=net.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
const environment={...process.env,PATH:path.join(process.env.SystemRoot||'C:/Windows','System32')};delete environment.NODE_OPTIONS;
const child=spawn(executable,['--offline','--no-open','--host','127.0.0.1','--port',String(port)],{cwd:workingFolder,env:environment,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='',spawnError;child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);child.once('error',error=>spawnError=error);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  let ready=false;
  for(let attempt=0;attempt<150;attempt++){
    if(spawnError)throw spawnError;
    assert.equal(child.exitCode,null,'The copied update must stay running.');
    try{ready=(await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(500)})).ok;}catch{}
    if(ready)break;await pause(100);
  }
  assert.ok(ready,'The copied update must start with the existing database.');
  const state=await (await fetch(`http://127.0.0.1:${port}/teacher/api/game`)).json();
  if(before.rows.classrooms.length){
    assert.equal(state.isTeacher,true,'The existing classroom must open directly.');
    assert.equal(state.dashboard.students.length,before.rows.students.length,'All existing students must appear.');
    const students=new Map(state.dashboard.students.map(student=>[student.id,student]));
    for(const row of before.rows.students){
      const student=students.get(row.id);assert.ok(student,'An existing student must remain in the updated dashboard.');
      for(const [stored,visible] of [['name','name'],['coins','coins'],['total_solved','totalSolved'],['streak','streak'],['avatar','avatar'],['theme','theme'],['level_id','levelId'],['goal','goal'],['teacher_note','teacherNote']])assert.ok(student[visible]===row[stored],'An existing student profile or balance changed.');
      assert.ok(JSON.stringify(student.best)===JSON.stringify(JSON.parse(row.best)),'Personal bests must be retained.');
      const avatar=JSON.parse(row.block_avatar);
      assert.equal(student.blockAvatar.level,avatar.level,'Avatar upgrade level must be retained.');
      assert.equal(student.blockAvatar.accessory,avatar.accessory,'Equipped accessory must be retained.');
      for(const item of avatar.owned)assert.ok(student.blockAvatar.owned.includes(item),'Previously bought accessories must remain owned.');
      const latest=before.rows.games.filter(game=>game.student_id===row.id).reduce((current,game)=>!current||game.updated_at>=current.updated_at?game:current,undefined);
      if(latest){
        const saved=JSON.parse(latest.data);
        assert.equal(student.game.id,saved.id,'The existing puzzle must remain available.');
        assert.ok(JSON.stringify(student.game.board)===JSON.stringify(saved.board),'The saved board must remain unchanged.');
        assert.ok(JSON.stringify(student.game.notes)===JSON.stringify(saved.notes),'Saved notes must remain unchanged.');
      }
    }
  }
  const after=inspect(fixtureDatabase);
  assert.deepEqual(after.fingerprints,before.fingerprints,'Every stored row, including PIN hashes, games, scores, awards, prizes, and sessions, must survive startup unchanged.');
  const counts={students:before.rows.students.length,games:before.rows.games.length,records:before.rows.records.length,prizes:before.rows.redemptions.length};
  writeFileSync(path.join(fixture,'verification.json'),JSON.stringify({passed:true,counts,tablesChecked:Object.keys(before.fingerprints),readOnlySource:true,offlineCopyOnly:true},null,2));
  console.log('PASS existing classroom upgrade: '+JSON.stringify(counts)+'. All stored rows unchanged; accounts, balances, purchases and saved puzzles restored.');
  console.log('Consistent classroom backup: '+snapshot);
}finally{
  writeFileSync(path.join(fixture,'server.log'),log);
  if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
}
