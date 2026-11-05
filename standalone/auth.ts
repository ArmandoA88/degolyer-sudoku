import { AsyncLocalStorage } from 'node:async_hooks';

export type ChatGPTUser={userId:string;displayName:string;email:string;fullName:string|null};
export const localTeacher:ChatGPTUser={userId:'standalone-teacher',displayName:'Teacher',email:'local-teacher@degolyer.invalid',fullName:'Teacher'};
const identity=new AsyncLocalStorage<ChatGPTUser|null>();
export function withLocalIdentity<T>(user:ChatGPTUser|null,callback:()=>T):T{return identity.run(user,callback);}
export async function getChatGPTUser():Promise<ChatGPTUser|null>{return identity.getStore()??null;}
export function chatGPTSignInPath(){return '/teacher';}
export function chatGPTSignOutPath(){return '/signout-with-chatgpt';}
