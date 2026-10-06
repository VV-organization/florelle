import {describe,it,expect,afterAll} from 'vitest';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {randomUUID} from 'node:crypto';
import {AuthService} from '../auth.service';
import type {Database} from '../../../shared/db/client';
import type {RedisClient} from '../../../shared/redis/client';

describe.skipIf(!process.env.TEST_DATABASE_URL)('registration challenge ownership',()=>{
 const sql=postgres(process.env.TEST_DATABASE_URL??'postgresql://unused:unused@localhost/unused',{max:2});
 const db=drizzle(sql) as Database;
 const emails:string[]=[];
 afterAll(async()=>{for(const email of emails)await sql`delete from users where email=${email}`;await sql.end();});
 function setup(){
  let number=100000;const sessions=new Map<string,string>();
  const service=new AuthService(db,{set:async(k:string,v:string)=>{sessions.set(k,v);return 'OK';},get:async(k:string)=>sessions.get(k),del:async(k:string)=>sessions.delete(k)} as unknown as RedisClient,{accessSecret:new TextEncoder().encode('a'.repeat(40)),refreshSecret:new TextEncoder().encode('b'.repeat(40)),accessTtl:'15m',refreshTtl:'30d',refreshTtlSeconds:2592000,registrationCodeTtlSeconds:600,registrationCodePepper:'test-code-pepper'},{sendRegistrationCode:async()=>{}},{now:()=>new Date(),createRegistrationCode:()=>String(++number)});
  const email=`challenge-${randomUUID()}@florelle.test`;emails.push(email);
  return {service,email};
 }
 it('activates credentials submitted by the verified registration, never pre-registered credentials',async()=>{
  const {service,email}=setup();
  await service.register({customerType:'individual',email,name:'Attacker',password:'attacker-password'});
  const victim=await service.register({customerType:'individual',email,name:'Email Owner',password:'owner-password'});
  await service.verifyRegistrationCode({email,code:'100002',challengeId:victim.challengeId});
  await expect(service.login({email,password:'attacker-password'})).rejects.toThrow();
  const login=await service.login({email,password:'owner-password'});expect(login.user.name).toBe('Email Owner');
 });
 it('rejects a code from a different registration even for the same email',async()=>{
  const {service,email}=setup();
  const owner=await service.register({customerType:'individual',email,name:'Owner',password:'owner-password'});
  await service.register({customerType:'individual',email,name:'Attacker',password:'attacker-password'});
  await expect(service.verifyRegistrationCode({email,code:'100002',challengeId:owner.challengeId})).rejects.toThrow();
  await service.verifyRegistrationCode({email,code:'100001',challengeId:owner.challengeId});
  await expect(service.login({email,password:'attacker-password'})).rejects.toThrow();
 });
});
