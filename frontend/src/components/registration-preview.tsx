'use client';
import {useState,useEffect,type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import MotionText from './motion-text';
import {api,safeReturn} from '@/lib/api-client';
import type {User} from '@/lib/storefront-types';
import {useShop} from './shop-context';

export default function RegistrationPreview(){
 const s=useShop(),router=useRouter();
 const[returnTo,setReturnTo]=useState('/account');useEffect(()=>setReturnTo(safeReturn(new URLSearchParams(location.search).get('return'))),[]);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[challenge,setChallenge]=useState<{challengeId:string;email:string;resendAvailableAt:string}|null>(null),[registration,setRegistration]=useState<Record<string,unknown>|null>(null);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  const form=new FormData(e.currentTarget);
  try{
   if(challenge){const result=await api.request<{user:User;accessToken:string}>('/auth/register/verify',{method:'POST',body:JSON.stringify({challengeId:challenge.challengeId,email:challenge.email,code:form.get('code')})});api.setToken(result.accessToken);s.setUser(result.user);router.push(returnTo);}
   else{const payload={customerType:s.segment==='b2b'?'legal_entity':'individual',name:form.get('name'),phone:form.get('phone')||'',email:form.get('email'),password:form.get('password'),company:form.get('company')||''};setRegistration(payload);setChallenge(await api.request('/auth/register',{method:'POST',body:JSON.stringify(payload)}));}

  }catch(e){setError(e instanceof Error?e.message:s.t('Не удалось создать аккаунт. Попробуйте ещё раз.','Unable to create your account. Please try again.'))}
  finally{setBusy(false)}
 }
 async function resend(){if(!registration||busy)return;setBusy(true);setError('');try{setChallenge(await api.request('/auth/register',{method:'POST',body:JSON.stringify(registration)}))}catch(e){setError(e instanceof Error?e.message:'Ошибка')}finally{setBusy(false)}}
 return <main className="ym-hide-content page-shell commerce-page"><div className="commerce-columns"><section><MotionText as="h1">{s.t('Давайте','Let’s')} <span className="script">{s.t('знакомиться','meet')}</span></MotionText><MotionText as="p">{s.t('Ваши цветы, заказы и особенные моменты — в одном месте.','Your flowers, orders and special moments, together.')}</MotionText><Link className="text-link" href={"/account?return="+encodeURIComponent(returnTo)}>{s.t('Уже есть аккаунт? Войти','Already registered? Sign in')}</Link></section><section className="preview-form"><form onSubmit={submit}><h2>{challenge?s.t('Подтвердите почту','Verify your email'):s.t('Создать аккаунт','Create account')}</h2>{challenge?<><p>{s.t('Код отправлен на','We sent a code to')} {challenge.email}</p><label>{s.t('Код из письма','Email verification code')}<input className="ym-disable-keys" name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6}/></label><button type="button" className="text-link" disabled={busy} onClick={resend}>{s.t('Отправить код ещё раз','Resend code')}</button></>:<><label>{s.t('Имя и фамилия','Full name')}<input className="ym-disable-keys" name="name" autoComplete="name" required minLength={2} maxLength={100}/></label><label>{s.t('Электронная почта','Email address')}<input className="ym-disable-keys" name="email" type="email" autoComplete="email" required maxLength={200}/></label><label>{s.t('Телефон','Phone')}<input className="ym-disable-keys" name="phone" type="tel" autoComplete="tel" maxLength={25}/></label>{s.segment==='b2b'&&<label>{s.t('Компания','Company')}<input className="ym-disable-keys" name="company" autoComplete="organization" required minLength={2} maxLength={200}/></label>}<label>{s.t('Пароль','Password')}<input className="ym-disable-keys" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128}/><small>{s.t('Не менее 8 символов','At least 8 characters')}</small></label></>}{error&&<MotionText as="p" role="alert" className="error-message">{error}</MotionText>}<button className="button primary" disabled={busy}>{busy?s.t('Подождите…','Please wait…'):challenge?s.t('Подтвердить','Verify'):s.t('Создать аккаунт','Create account')}</button></form></section></div></main>
}
