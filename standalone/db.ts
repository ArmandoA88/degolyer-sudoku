import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type Value = string | number | bigint | null | Uint8Array;
export type Migration = {name:string;sql:string};
export type QueryResult<T=Record<string,unknown>> = {success:true;results:T[];meta:{changes:number;last_row_id:number}};

/** The subset of D1 used by the game, backed by a single transactional SQLite connection. */
export class LocalDatabase {
  readonly sqlite:DatabaseSync;
  constructor(filename:string,migrations:Migration[]) {
    mkdirSync(dirname(filename),{recursive:true});
    this.sqlite=new DatabaseSync(filename);
    this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS _standalone_migrations(name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
    for(const migration of migrations){
      if(this.sqlite.prepare('SELECT name FROM _standalone_migrations WHERE name=?').get(migration.name))continue;
      this.sqlite.exec('BEGIN IMMEDIATE');
      try{
        this.sqlite.exec(migration.sql);
        this.sqlite.prepare('INSERT INTO _standalone_migrations(name,applied_at) VALUES(?,?)').run(migration.name,Date.now());
        this.sqlite.exec('COMMIT');
      }catch(error){this.sqlite.exec('ROLLBACK');throw error;}
    }
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS _standalone_auth(id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS _standalone_teacher_sessions(hash TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS _standalone_limits(key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
  }
  prepare(query:string){return new LocalStatement(this,query,[]);}
  async batch(statements:LocalStatement[]){
    if(statements.some(statement=>statement.database!==this))throw new Error('A batch must use one classroom database.');
    this.sqlite.exec('BEGIN IMMEDIATE');
    try{
      const results=statements.map(statement=>statement.execute());
      this.sqlite.exec('COMMIT');
      return results;
    }catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
  close(){this.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');this.sqlite.close();}
}

export class LocalStatement {
  constructor(readonly database:LocalDatabase,readonly query:string,readonly values:Value[]){}
  bind(...values:unknown[]){
    if(values.some(value=>value!==null&&!['string','number','bigint'].includes(typeof value)&&!(value instanceof Uint8Array)))throw new Error('Unsupported database parameter.');
    return new LocalStatement(this.database,this.query,values as Value[]);
  }
  execute<T=Record<string,unknown>>():QueryResult<T>{
    const statement=this.database.sqlite.prepare(this.query);
    const isRows=/^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(this.query)||/\bRETURNING\b/i.test(this.query);
    if(isRows){
      const results=statement.all(...this.values) as T[];
      return {success:true,results,meta:{changes:0,last_row_id:0}};
    }
    const result=statement.run(...this.values);
    return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};
  }
  async all<T=Record<string,unknown>>(){return this.execute<T>();}
  async first<T=Record<string,unknown>>(column?:string):Promise<T|null>{
    const row=this.database.sqlite.prepare(this.query).get(...this.values) as Record<string,unknown>|undefined;
    return row?(column?row[column] as T:row as T):null;
  }
  async run(){return this.execute();}
}
