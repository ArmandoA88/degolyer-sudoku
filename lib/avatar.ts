import type { AvatarAccessory, BlockAvatar } from './types';

export const AVATAR_COLORS = [
  {id:'ocean',name:'Ocean',hex:'#4689ce'},
  {id:'coral',name:'Coral',hex:'#ed8c79'},
  {id:'sunshine',name:'Sunshine',hex:'#f0c65c'},
  {id:'mint',name:'Mint',hex:'#69b89c'},
  {id:'violet',name:'Violet',hex:'#a18cce'},
] as const;
export const AVATAR_FACES = [
  {id:'smile',name:'Happy'}, {id:'focus',name:'Focused'}, {id:'cool',name:'Cool'},
] as const;
export const AVATAR_ITEMS = [
  {id:'cap',name:'Explorer cap',cost:100,description:'A little cap for your next puzzle adventure.'},
  {id:'beanie',name:'Cozy beanie',cost:150,description:'A striped knit hat with a fluffy pom-pom.'},
  {id:'bow',name:'Celebration bow',cost:180,description:'A bright berry bow for every small victory.'},
  {id:'headphones',name:'Beat headphones',cost:250,description:'Cushioned headphones with a golden music note.'},
  {id:'wizard',name:'Star wizard hat',cost:350,description:'A tall purple hat sprinkled with puzzle magic.'},
  {id:'crown',name:'Puzzle crown',cost:400,description:'A golden crown for your block buddy.'},
  {id:'pirate',name:'Treasure captain hat',cost:450,description:'Sail toward your next discovery in a captain hat.'},
  {id:'flower',name:'Sunflower hat',cost:500,description:'A sunny flower with a leafy green brim.'},
  {id:'wings',name:'Dream wings',cost:600,description:'Give your block buddy a pair of wings.'},
  {id:'astronaut',name:'Space explorer helmet',cost:750,description:'A silver space helmet with a clear blue visor.'},
  {id:'halo',name:'Starlight halo',cost:900,description:'A glowing golden halo with little trailing stars.'},
  {id:'dragon',name:'Emerald dragon set',cost:1200,description:'Emerald wings and curved horns for a brave buddy.'},
  {id:'robot',name:'Robot antenna set',cost:1500,description:'Antennae, side panels, and a bright robot badge.'},
  {id:'saturn',name:'Saturn orbit',cost:1800,description:'A tiny planet hat and a colorful orbit around your buddy.'},
  {id:'aurora',name:'Aurora guardian set',cost:2500,description:'Rainbow crystal wings and a shining star crest.'},
] as const satisfies readonly {id:Exclude<AvatarAccessory,'none'>;name:string;cost:number;description:string}[];
export const AWARDS = [
  {id:'first-puzzle',name:'First discovery',description:'Solve your first puzzle.',icon:'\u{1F331}'},
  {id:'puzzle-five',name:'Pattern explorer',description:'Solve 5 puzzles.',icon:'\u{1F9ED}'},
  {id:'puzzle-twenty',name:'Puzzle builder',description:'Solve 20 puzzles.',icon:'\u{1F3C6}'},
  {id:'perfect',name:'Clear thinker',description:'Solve a puzzle without mistakes or power-ups.',icon:'\u{1F31F}'},
  {id:'streak-three',name:'On a roll',description:'Solve 3 puzzles in a row without mistakes.',icon:'\u{1F525}'},
] as const;

export const defaultBlockAvatar = ():BlockAvatar => ({color:'ocean',face:'smile',accessory:'none',level:1,owned:[]});
export function avatarUpgradeCost(level:number):number|null {return Number.isInteger(level)&&level>=1&&level<5?level*30:null;}

/** Sanitize stored data; clients never choose balances, inventory, or levels. */
export function readBlockAvatar(value:unknown):BlockAvatar {
  let data:Partial<BlockAvatar>={};
  try{data=(typeof value==='string'?JSON.parse(value):value)??{};}catch{}
  const owned:string[]=Array.isArray(data.owned)?AVATAR_ITEMS.filter(item=>data.owned!.includes(item.id)).map(item=>item.id):[];
  return {
    color:AVATAR_COLORS.some(item=>item.id===data.color)?data.color!:'ocean',
    face:AVATAR_FACES.some(item=>item.id===data.face)?data.face!:'smile',
    accessory:data.accessory&&owned.includes(data.accessory)&&AVATAR_ITEMS.some(item=>item.id===data.accessory)?data.accessory:'none',
    level:Number.isInteger(data.level)&&Number(data.level)>=1&&Number(data.level)<=5?data.level!:1,
    owned,
  };
}

/** Existing saved totals also qualify when upgrading an old classroom. */
export function earnedAwards(value:unknown,totalSolved:number,streak:number):string[] {
  let stored:Record<string,boolean>={};
  try{stored=(typeof value==='string'?JSON.parse(value):value)??{};}catch{}
  const saved=(key:string)=>stored[key]===true||(stored[key] as unknown)===1;
  const earned:Record<string,boolean>={'first-puzzle':saved('first-puzzle')||totalSolved>=1,'puzzle-five':saved('puzzle-five')||totalSolved>=5,'puzzle-twenty':saved('puzzle-twenty')||totalSolved>=20,'perfect':saved('perfect'),'streak-three':saved('streak-three')||streak>=3};
  return AWARDS.filter(award=>earned[award.id]===true).map(award=>award.id);
}
