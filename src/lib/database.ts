import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {cookies} from 'next/headers';
let instance:DatabaseSync|undefined;
export function db(){if(instance)return instance;const dataDir=process.env.DATA_DIR||join(process.cwd(),'data');mkdirSync(dataDir,{recursive:true});instance=new DatabaseSync(join(dataDir,'store.sqlite'));instance.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');instance.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',company TEXT NOT NULL DEFAULT '');CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL,created TEXT NOT NULL);`);return instance}
export type DbUser={id:string;name:string;email:string;phone:string;company:string;password?:string};
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function getUser():Promise<DbUser|null>{const token=(await cookies()).get('fp_session')?.value;if(!token)return null;return db().prepare('SELECT u.id,u.name,u.email,u.phone,u.company FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(token),Date.now()) as DbUser|undefined||null}
export async function session(userId:string){const token=randomBytes(32).toString('hex');db().prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db().prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),userId,Date.now()+30*86400000);(await cookies()).set('fp_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:30*86400})}
export async function safeBody(request:Request){const origin=request.headers.get('origin');if(!origin||origin!==(process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL||new URL(request.url).protocol+'//'+request.headers.get('host')))throw Error('Недопустимый источник запроса');if(!request.headers.get('content-type')?.includes('application/json'))throw Error('Ожидается JSON');const text=await request.text();if(text.length>20000)throw Error('Слишком большой запрос');return JSON.parse(text)}
const attempts=new Map<string,{n:number;until:number}>();
export function allowAttempt(key:string){const now=Date.now();for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);const record=attempts.get(key)||{n:0,until:now+900000};record.n++;attempts.set(key,record);return record.n<=20}
