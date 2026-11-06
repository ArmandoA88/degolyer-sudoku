import { createRoot } from 'react-dom/client';
import Home, {type ClassroomServerInfo} from '../app/page';
import '../app/globals.css';

const container = document.getElementById('root');
if (!container) throw new Error('The Sudoku application container is missing.');
let latest:ClassroomServerInfo|null=null;
let refreshing:Promise<ClassroomServerInfo>|null=null;
function publish(info:ClassroomServerInfo){
  latest=info;
  window.__SUDOKU_SERVER_INFO__=info;
  if(info.shareOrigin)window.__SUDOKU_SHARE_ORIGIN__=info.shareOrigin;
  else delete window.__SUDOKU_SHARE_ORIGIN__;
  window.dispatchEvent(new CustomEvent('sudoku-server-info',{detail:info}));
  return info;
}
function origin(value:unknown):string|null{
  if(typeof value!=='string')return null;
  try{const parsed=new URL(value);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.origin:null;}catch{return null;}
}
async function loadInfo():Promise<ClassroomServerInfo>{
  try {
    const response = await fetch('/api/server-info', {cache:'no-store', signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Student link unavailable.');
    const data=await response.json() as Partial<ClassroomServerInfo>;
    const state=data.tunnel?.state??'off';
    if(!['off','starting','ready','failed'].includes(state))throw new Error('Invalid student link state.');
    const shareOrigin=origin(data.shareOrigin);
    if(state==='ready'&&(!shareOrigin||!shareOrigin.startsWith('https://')))throw new Error('The public student link is not ready.');
    return publish({
      shareOrigin:state==='starting'||state==='failed'?null:shareOrigin,
      localOrigin:origin(data.localOrigin)??window.location.origin,
      lanOrigin:origin(data.lanOrigin)??(state==='off'?shareOrigin:null),
      tunnel:{state,...(typeof data.tunnel?.error==='string'?{error:data.tunnel.error}:{})},
    });
  } catch {
    return publish({shareOrigin:null,localOrigin:latest?.localOrigin??window.location.origin,lanOrigin:latest?.lanOrigin??null,tunnel:{state:'failed',error:'Could not load the student link. Check the server window and try again.'}});
  }
}
function refreshInfo(){
  if(!refreshing)refreshing=loadInfo().finally(()=>{refreshing=null;});
  return refreshing;
}
async function start() {
  const refresh=()=>{void refreshInfo();};
  window.addEventListener('sudoku-refresh-server-info',refresh);
  const info=await refreshInfo();
  createRoot(container!).render(<Home />);
  // Give a requested tunnel time to connect without keeping a background poll alive forever.
  let attempts=0;
  const poll=info.tunnel.state==='starting'?window.setInterval(async()=>{
    if(++attempts>=60){window.clearInterval(poll);return;}
    const current=await refreshInfo();
    if(current.tunnel.state!=='starting')window.clearInterval(poll);
  },2000):undefined;
  window.addEventListener('pagehide',()=>{if(poll!==undefined)window.clearInterval(poll);},{once:true});
}
void start();
