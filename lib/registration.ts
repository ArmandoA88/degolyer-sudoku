/** Canonical display names and private uniqueness keys for student enrollment. */
export function normalizeStudentName(value:unknown):string {
  if(typeof value!=='string')throw new Error('Enter your name using 1–30 characters.');
  const name=value.normalize('NFKC').replace(/\s+/gu,' ').trim();
  if(Array.from(name).length<1||Array.from(name).length>30||/\p{Cc}/u.test(name))throw new Error('Enter your name using 1–30 characters.');
  return name;
}
export function studentNameKey(value:string):string {
  return normalizeStudentName(value).toLocaleUpperCase('en-US').toLocaleLowerCase('en-US').normalize('NFKC');
}
export async function registeredStudentCode(name:string):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(studentNameKey(name)));
  return 'RG-'+Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16).toUpperCase();
}
export const isRegisteredStudentCode=(code:string)=>/^RG-[0-9a-f]{16}$/i.test(code);
export function registrationAvatar(value:unknown):string {
  const avatars=['🐬','🦊','🐼','🐸','🦁','🐨','🐰','🦉','🐱'];
  return typeof value==='string'&&avatars.includes(value)?value:'🐬';
}
