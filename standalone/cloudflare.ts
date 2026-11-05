import type { LocalDatabase } from './db';

// The standalone bundle aliases cloudflare:workers to this local binding.
export const env:{DB?:LocalDatabase;CLASSROOM_TEACHER_EMAIL?:string}={};
export function setLocalDatabase(database:LocalDatabase){env.DB=database;}
