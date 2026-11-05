/** Local-only race and idempotency verification. Leaves one clearly named fixture student. */
import assert from 'node:assert/strict';

const target=new URL(process.argv[2]??'http://127.0.0.1:5173');
assert.ok(target.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(target.hostname),'This fixture script only accepts HTTP localhost.');
const base=target.origin,tag=Date.now().toString(36).toUpperCase(),code=`CC${tag}`,pin='6392';
function client(){
  const cookies=new Map();
  return async(payload,path='/api/game')=>{
    const response=await fetch(base+path,{method:payload?'POST':'GET',redirect:'manual',headers:{origin:base,...(payload?{'content-type':'application/json'}:{}),...(cookies.size?{cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{})},body:payload?JSON.stringify(payload):undefined});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';',1)[0],at=pair.indexOf('=');if(at>0)cookies.set(pair.slice(0,at),pair.slice(at+1));}
    const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body={raw:raw.slice(0,300)};}
    return {status:response.status,body};
  };
}
const teacher=client(),student=client();
async function okay(who,payload,path){const result=await who(payload,path);assert.equal(result.status,200,JSON.stringify(result));assert.ok(!result.body.error);return result.body;}
function solve(game){
  const board=[...game.puzzle],{size,boxRows,boxCols}=game;
  function fill(){const at=board.indexOf(0);if(at<0)return true;const row=Math.floor(at/size),col=at%size;
    for(let value=1;value<=size;value++){
      let valid=true;
      for(let i=0;i<size;i++)if(board[row*size+i]===value||board[i*size+col]===value)valid=false;
      for(let r=Math.floor(row/boxRows)*boxRows;r<Math.floor(row/boxRows)*boxRows+boxRows;r++)for(let c=Math.floor(col/boxCols)*boxCols;c<Math.floor(col/boxCols)*boxCols+boxCols;c++)if(board[r*size+c]===value)valid=false;
      if(valid){board[at]=value;if(fill())return true;board[at]=0;}
    }return false;
  }
  assert.ok(fill());return board;
}
let originalSettings;
try{
  const signin=await teacher(undefined,'/signin-with-chatgpt?return_to=/');assert.ok([200,302,303,307,308].includes(signin.status));
  let t=await okay(teacher);assert.ok(t.isTeacher&&t.classroom,'Use the local fixture classroom owned by the mock teacher.');
  originalSettings=structuredClone(t.classroom);
  const prizeId=`race-${tag}`,prize={id:prizeId,name:`Concurrency fixture ${tag}`,description:'Local race-test reward',cost:10,icon:'star'};
  await okay(teacher,{action:'settings',settings:{...t.classroom,prizes:[...t.classroom.prizes,prize]}});
  t=await okay(teacher,{action:'saveStudent',student:{name:`Concurrency ${tag}`,code,pin,avatar:'owl',theme:'sage',levelId:'mini',goal:3}});
  const fixture=t.dashboard.students.find(s=>s.code===code);assert.ok(fixture);
  assert.equal('code' in t.classroom,false);
  let s=await okay(student,{action:'login',studentId:fixture.id,pin});
  s=await okay(student,{action:'start',levelId:'mini'});const replacedGame=s.game.id;
  s=await okay(student,{action:'start',levelId:'mini'});const originalBoard=[...s.game.board],editable=s.game.puzzle.findIndex(v=>!v);
  const stale=await student({action:'move',gameId:replacedGame,index:editable,value:1});assert.equal(stale.status,409);
  let snapshot=await okay(student);assert.deepEqual(snapshot.game.board,originalBoard);assert.equal(snapshot.game.revision,s.game.revision);
  console.log('PASS stale gameId rejects with 409 and does not mutate the replacement board');

  const staleRevision=await student({action:'move',gameId:s.game.id,revision:s.game.revision+1,index:editable,value:1});assert.equal(staleRevision.status,409);
  snapshot=await okay(student);assert.deepEqual(snapshot.game.board,originalBoard);
  console.log('PASS stale revision rejects with 409 and does not mutate the board');

  const solution=solve(s.game),blanks=s.game.puzzle.flatMap((v,i)=>v?[]:[i]),last=blanks.pop();
  for(const index of blanks)s=await okay(student,{action:'move',gameId:s.game.id,revision:s.game.revision,index,value:solution[index]});
  const final={action:'move',gameId:s.game.id,revision:s.game.revision,index:last,value:solution[last]};
  const completions=await Promise.all([student(final),student(final)]);
  assert.equal(completions.filter(r=>r.status===200).length,1,JSON.stringify(completions.map(r=>({status:r.status,error:r.body.error}))));
  assert.equal(completions.filter(r=>r.status===409).length,1);
  s=await okay(student);assert.equal(s.game.status,'completed');assert.equal(s.student.totalSolved,1);assert.equal(s.student.coins,30);assert.equal(s.records.filter(r=>r.id===s.game.id).length,1);
  const replay=await student(final);assert.equal(replay.status,409);
  snapshot=await okay(student);assert.equal(snapshot.student.coins,30);assert.equal(snapshot.student.totalSolved,1);assert.equal(snapshot.records.length,1);
  console.log('PASS concurrent final moves and replay produce exactly one record, one solved count, and 30 coins');

  const claims=await Promise.all(Array.from({length:8},()=>student({action:'redemption',prizeId})));
  const successful=claims.filter(r=>r.status===200).length;assert.equal(successful,3,JSON.stringify(claims.map(r=>({status:r.status,error:r.body.error}))));
  assert.ok(claims.filter(r=>r.status!==200).every(r=>r.status===400));
  s=await okay(student);assert.equal(s.student.coins,0);assert.equal(s.redemptions.filter(r=>r.prizeName===prize.name).length,3);
  const noCoins=await student({action:'redemption',prizeId});assert.equal(noCoins.status,400);s=await okay(student);assert.equal(s.student.coins,0);
  console.log('PASS eight concurrent prize claims spend only the available 30 coins, create three requests, and never go negative');
  console.log(`Concurrency smoke passed. Local fixture retained: ${code} (${fixture.id}).`);
}finally{
  if(originalSettings){await okay(teacher,{action:'settings',settings:originalSettings});console.log('Restored classroom settings and prize catalog.');}
}
