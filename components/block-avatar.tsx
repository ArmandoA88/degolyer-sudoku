import {AVATAR_COLORS,AVATAR_ITEMS,defaultBlockAvatar} from '../lib/avatar';
import type {AvatarAccessory,BlockAvatar as BlockAvatarData} from '../lib/types';

function AccessoryBack({accessory}:{accessory:AvatarAccessory}){
 switch(accessory){
  case 'wings':return <g fill="#d9effc" stroke="#7aafd5" strokeWidth="2.5"><path d="M48 80 14 60 10 89 25 113 48 119Z"/><path d="m112 80 34-20 4 29-15 24-23 6Z"/><path d="m22 81 21 19M138 81l-21 19" fill="none"/></g>;
  case 'dragon':return <g fill="#66b985" stroke="#285843" strokeWidth="2.5" strokeLinejoin="round"><path d="M49 88 12 53 7 94 23 85 20 115 39 104 46 124Zm62 0 37-35 5 41-16-9 3 30-19-11-7 20Z"/><path d="m15 61 27 44m103-44-27 44" fill="none" stroke="#a9df92" strokeWidth="3"/></g>;
  case 'astronaut':return <g stroke="#4e7087" strokeWidth="2.5"><path d="M38 88H29V50q0-39 51-39t51 39v38h-11" fill="#dbe9f1"/><path d="M36 89V51q0-31 44-31t44 31v38" fill="#bce8f7"/><path d="M35 96H21v32h21m83-32h14v32h-21" fill="#e6eef4"/></g>;
  case 'robot':return <g stroke="#385e79" strokeWidth="2.5" strokeLinecap="round"><path d="M49 30 36 14m75 16 13-16" fill="none"/><circle cx="34" cy="11" r="6" fill="#f7bd67"/><circle cx="126" cy="11" r="6" fill="#75d4d0"/><path d="M34 93H17v38h23m86-38h17v38h-23" fill="#c5d8e6"/><path d="M20 102h13m-13 9h13m94-9h13m-13 9h13" stroke="#63849a"/></g>;
  case 'saturn':return <g fill="none" strokeLinecap="round"><ellipse cx="80" cy="88" rx="71" ry="25" transform="rotate(-16 80 88)" stroke="#7a72bc" strokeWidth="9"/><ellipse cx="80" cy="88" rx="71" ry="25" transform="rotate(-16 80 88)" stroke="#c4b8ee" strokeWidth="3"/><circle cx="15" cy="83" r="6" fill="#f5be70" stroke="#9d753d" strokeWidth="2"/><circle cx="140" cy="53" r="4" fill="#91d6dc" stroke="#497e99" strokeWidth="2"/></g>;
  case 'aurora':return <g stroke="#586ca5" strokeWidth="2" strokeLinejoin="round"><path d="m48 86-25-42-14 8 7 52 28 20Zm64 0 25-42 14 8-7 52-28 20Z" fill="#b5a4ee"/><path d="m44 90-21-46 2 59 19 21Zm72 0 21-46-2 59-19 21Z" fill="#86d6dc"/><path d="m16 104 9-1 19 21-17-7Zm128 0-9-1-19 21 17-7Z" fill="#edacdb"/><path d="m12 54 11-10 2 59Zm136 0-11-10-2 59Z" fill="#f8dea0"/></g>;
  default:return null;
 }
}

function AccessoryFront({accessory}:{accessory:AvatarAccessory}){
 switch(accessory){
  case 'cap':return <g stroke="#173e63" strokeWidth="2.5" strokeLinejoin="round"><path d="M40 40V27q35-18 70 0v13Z" fill="#2c698b"/><path d="M39 38h76l12 10H39Z" fill="#75bfd1"/><path d="M72 26v11" fill="none" stroke="#9bd6e2"/></g>;
  case 'beanie':return <g stroke="#6d486c" strokeWidth="2.5"><path d="M43 37q1-25 33-25t33 25" fill="#de8ba8"/><path d="M47 27h58m-53-8h48" fill="none" stroke="#f9d9e3" strokeWidth="4"/><rect x="39" y="32" width="74" height="15" rx="5" fill="#a86eae"/><path d="M47 36v7m10-7v7m10-7v7m10-7v7m10-7v7m10-7v7m10-7v7" stroke="#e9bdd9" strokeWidth="2"/><circle cx="76" cy="9" r="7" fill="#f5c7da"/></g>;
  case 'bow':return <g stroke="#933f67" strokeWidth="2.5" strokeLinejoin="round"><path d="M80 27Q54 6 47 16L44 39q21 4 36-8Zm3 0q26-21 33-11l3 23q-21 4-36-8Z" fill="#ed84a9"/><path d="m73 31-12 20 16-3 5-15 6 15 15 3-13-20" fill="#d65b8a"/><path d="m53 23 18 6m39-6-18 6" stroke="#ffd2df"/><rect x="74" y="23" width="15" height="14" rx="4" fill="#f6b2ca"/></g>;
  case 'headphones':return <g stroke="#374766" strokeWidth="2.5"><path d="M35 58V44q0-30 45-30t45 30v14" fill="none" strokeWidth="10"/><path d="M35 47V43q0-24 45-24t45 24v4" fill="none" stroke="#8dc7da" strokeWidth="4"/><rect x="29" y="50" width="15" height="31" rx="6" fill="#8bc5da"/><rect x="119" y="50" width="15" height="31" rx="6" fill="#8bc5da"/><path d="M124 55v19m-90-19v19" stroke="#d8f0f4" strokeWidth="3"/><path d="m84 103 12-3v14m-12-11v14" fill="none" stroke="#e5ac3f"/><ellipse cx="80" cy="117" rx="5" ry="3" fill="#f4c85e" stroke="#ba8630"/><ellipse cx="92" cy="114" rx="5" ry="3" fill="#f4c85e" stroke="#ba8630"/></g>;
  case 'wizard':return <g stroke="#574379" strokeWidth="2.5" strokeLinejoin="round"><path d="m46 36 22-31 11 12 18 19" fill="#a48bd1"/><path d="m58 25 36 9-4 6H50Z" fill="#e4b66b"/><path d="M32 36q47-9 94 0l-5 10H37Z" fill="#7962aa"/><path d="m70 15 2 4 5 1-4 3 1 5-4-2-4 2 1-5-4-3 5-1Z" fill="#ffdc7c" stroke="none"/><circle cx="86" cy="29" r="2" fill="#fff0ac" stroke="none"/></g>;
  case 'crown':return <path d="m43 37-4-23 18 12 15-18 15 18 19-12-4 23Z" fill="#f9d468" stroke="#986a24" strokeWidth="2.5" strokeLinejoin="round"/>;
  case 'pirate':return <g stroke="#33435c" strokeWidth="2.5" strokeLinejoin="round"><path d="M31 39q13-5 17-19 30-17 60 0 4 14 17 19L80 45Z" fill="#42506a"/><path d="M36 37q44 14 84 0" fill="none" stroke="#efc86a" strokeWidth="4"/><path d="m72 20 8 5 8-5m-16 9 8-4 8 4" stroke="#f7edd3"/><path d="m66 39-7 10 14-4m28-6 6 10-14-4" fill="#c87065"/></g>;
  case 'flower':return <g stroke="#826d2f" strokeWidth="2.5"><path d="M34 39q13-16 44-9 30-7 46 9-26 10-46 3-24 6-44-3Z" fill="#83b875" stroke="#4d7c49"/><g fill="#f4cd62"><ellipse cx="80" cy="13" rx="8" ry="11"/><ellipse cx="80" cy="35" rx="8" ry="11"/><ellipse cx="69" cy="24" rx="11" ry="8"/><ellipse cx="91" cy="24" rx="11" ry="8"/><ellipse cx="72" cy="16" rx="7" ry="10" transform="rotate(-45 72 16)"/><ellipse cx="88" cy="32" rx="7" ry="10" transform="rotate(-45 88 32)"/><ellipse cx="88" cy="16" rx="7" ry="10" transform="rotate(45 88 16)"/><ellipse cx="72" cy="32" rx="7" ry="10" transform="rotate(45 72 32)"/></g><circle cx="80" cy="24" r="9" fill="#a37a40"/><path d="m76 21 3 2m3 2 3 2m-10-1 2 2m4-9 2 2" stroke="#e9bd70" strokeWidth="2"/></g>;
  case 'astronaut':return <g stroke="#4e7087" strokeWidth="2.5" strokeLinejoin="round"><path d="M35 49v39q44 16 89 0V49" fill="none" stroke="#dbe9f1" strokeWidth="7"/><path d="M36 88q44 18 87 0v13q-44 13-87 0Z" fill="#e4eef4"/><rect x="25" y="54" width="11" height="24" rx="4" fill="#a4bbcd"/><rect x="124" y="54" width="11" height="24" rx="4" fill="#a4bbcd"/><path d="m44 47 7-13 10-5" stroke="#effcff" strokeWidth="4" fill="none" strokeLinecap="round"/><rect x="71" y="94" width="17" height="7" rx="2" fill="#67c1ce"/><circle cx="101" cy="96" r="3" fill="#ec997d" stroke="none"/></g>;
  case 'halo':return <g stroke="#b78e35" strokeWidth="2" fill="#ffe38c"><ellipse cx="80" cy="16" rx="32" ry="9" fill="none" stroke="#c69736" strokeWidth="8"/><ellipse cx="80" cy="14" rx="32" ry="9" fill="none" stroke="#ffe69b" strokeWidth="4"/><path d="m28 37 3 7 7 3-7 3-3 7-3-7-7-3 7-3Zm109 32 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/><circle cx="126" cy="32" r="3" stroke="none"/><circle cx="20" cy="71" r="2.5" stroke="none"/></g>;
  case 'dragon':return <g stroke="#285843" strokeWidth="2.5" strokeLinejoin="round"><path d="M42 38q-13-18-3-31 0 16 18 23m45 8q13-18 3-31 0 16-18 23" fill="#e7cc89"/><path d="m52 35 10-17 11 16 10-19 11 20" fill="#84c981"/><path d="M42 37q35-9 70 0v8q-35-7-70 0Z" fill="#45986e"/><path d="m80 96 6 8-6 9-6-9Z" fill="#bfe798"/></g>;
  case 'robot':return <g stroke="#385e79" strokeWidth="2.5" strokeLinejoin="round"><path d="M39 40V29h76v11" fill="#c5d8e6"/><rect x="30" y="44" width="12" height="38" rx="3" fill="#89a9bd"/><rect x="121" y="40" width="12" height="42" rx="3" fill="#89a9bd"/><path d="M33 52h6m-6 8h6m-6 8h6m85-17h6m-6 8h6m-6 8h6" stroke="#e8f2f7" strokeWidth="2"/><rect x="70" y="95" width="28" height="29" rx="4" fill="#dce9ef"/><path d="m84 99-6 10h6l-3 11 11-15h-7l4-6" fill="#f4c65b" stroke="#bd8b35" strokeWidth="1.5"/><circle cx="54" cy="35" r="2" fill="#f4c65b" stroke="none"/><circle cx="63" cy="35" r="2" fill="#77c7c5" stroke="none"/></g>;
  case 'saturn':return <g strokeLinecap="round"><path d="M12 104q34 33 96-1" fill="none" stroke="#7a72bc" strokeWidth="9"/><path d="M12 104q34 33 96-1" fill="none" stroke="#c4b8ee" strokeWidth="3"/><circle cx="80" cy="23" r="16" fill="#e9b76d" stroke="#a1773e" strokeWidth="2.5"/><path d="M68 18h24m-26 8h28" stroke="#f8da9b" strokeWidth="3"/><ellipse cx="80" cy="24" rx="28" ry="6" transform="rotate(-15 80 24)" fill="none" stroke="#7e8abb" strokeWidth="4"/></g>;
  case 'aurora':return <g stroke="#586ca5" strokeWidth="2" strokeLinejoin="round"><path d="m42 39 12-18 13 14 13-22 13 22 14-14 8 18" fill="#a7dce5"/><path d="m80 5 5 9 10 2-7 7 1 11-9-5-9 5 1-11-7-7 10-2Z" fill="#ffe7a1"/><path d="M42 40h73" stroke="#d49bd3" strokeWidth="5"/><path d="m80 96 8 11-8 15-8-15Z" fill="#c2a9e9"/><path d="m80 96 8 11h-8Z" fill="#b9edf0"/><path d="m29 20 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm106 19 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#ffe7a1" stroke="none"/></g>;
  default:return null;
 }
}

/** A locally rendered block buddy; no image downloads or external assets. */
export function BlockAvatar({avatar=defaultBlockAvatar(),className='',decorative=false}:{avatar?:BlockAvatarData;className?:string;decorative?:boolean}){
 const color=AVATAR_COLORS.find(item=>item.id===avatar.color)?.hex||AVATAR_COLORS[0].hex;
 const accessoryName=AVATAR_ITEMS.find(item=>item.id===avatar.accessory)?.name;
 return <svg className={`block-avatar ${className}`} viewBox="0 0 160 174" role={decorative?undefined:'img'} aria-hidden={decorative||undefined} aria-label={decorative?undefined:`Level ${avatar.level} ${avatar.color} block buddy with ${avatar.face} face${accessoryName?` and ${accessoryName}`:''}`}>
  <ellipse cx="80" cy="161" rx="43" ry="7" fill="#153c6815"/>
  <AccessoryBack accessory={avatar.accessory}/>
  <g fill={color} stroke="#173e63" strokeWidth="2.5" strokeLinejoin="round">
   <path d="M39 91 23 95v33l16 5M121 91l16 4v33l-16 5"/>
   <path d="M52 134v21h23v-21m10 0v21h23v-21"/>
   <path d="M44 81h72v58H44Z"/>
   <path d="m42 39 14-9h65v54l-14 10H42Z"/>
  </g>
  <path d="m107 40 14-10v54l-14 10Z" fill="#173e6330"/>
  <path d="m42 39 14-9h65l-14 10Z" fill="#ffffff60"/>
  <path d="M44 113h72v26H44Z" fill="#173e6318"/>
  <path d="M52 91h15v17H52Z" fill="#ffffff75"/>
  {avatar.level>=2&&<path d="m80 99 5 9 10 2-7 7 1 11-9-5-9 5 1-11-7-7 10-2Z" fill="#ffdb70" stroke="#a67727" strokeWidth="1.5"/>}
  {avatar.level>=3&&<g fill="#d4edf8" stroke="#173e63" strokeWidth="2"><path d="M21 103h18v12H21Zm100 0h18v12h-18Z"/></g>}
  {avatar.level>=4&&<g fill="#ffe18c"><path d="M54 146h8v6h-8Zm45 0h8v6h-8Z"/><path d="m28 38 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm110 4 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/></g>}
  {avatar.level>=5&&<g fill="#7bcede"><path d="m37 139-12 10 12 2 5-10Zm86 0 12 10-12 2-5-10Z"/><path d="m77 22 3-7 3 7 7 3-7 3-3 7-3-7-7-3Z"/></g>}
  {avatar.face==='cool'?<g stroke="#173e63" strokeWidth="3" fill="#183b5f"><path d="M50 55h22v12H50Zm31 0h22v12H81Z"/><path d="M72 59h9"/><path d="m62 57 5 5m18-5 5 5" stroke="#8fc6e3" strokeWidth="2"/></g>:<g fill="#173e63"><rect x="57" y="56" width="8" height={avatar.face==='focus'?8:11} rx={avatar.face==='focus'?1:3}/><rect x="86" y="56" width="8" height={avatar.face==='focus'?8:11} rx={avatar.face==='focus'?1:3}/>{avatar.face==='focus'&&<path d="m53 52 15 1m15 0 15-1" stroke="#173e63" strokeWidth="3"/>}</g>}
  <path d={avatar.face==='focus'?'M69 77h14':'M66 75q10 11 20 0'} stroke="#173e63" strokeWidth="3" fill="none" strokeLinecap="round"/>
  <AccessoryFront accessory={avatar.accessory}/>
 </svg>
}
