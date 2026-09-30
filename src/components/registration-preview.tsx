'use client';
import {useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import MotionText from './motion-text';
import {useShop} from './shop-context';

export default function RegistrationPreview(){
 const s=useShop(),router=useRouter();
 const[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  const form=new FormData(e.currentTarget);
  try{
   const response=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'register',name:form.get('name'),phone:form.get('phone'),email:form.get('email'),password:form.get('password'),company:form.get('company')||''})});
   const data=await response.json();if(!response.ok)throw Error(data.error);
   s.setUser(data.user);router.push(new URLSearchParams(location.search).get('return')==='checkout'?'/checkout':'/account');
  }catch(e){setError(e instanceof Error?e.message:s.t('Не удалось создать аккаунт. Попробуйте ещё раз.','Unable to create your account. Please try again.'))}
  finally{setBusy(false)}
 }
 return <main className="page-shell commerce-page"><div className="commerce-columns"><section><MotionText as="h1">{s.t('Давайте','Let’s')} <span className="script">{s.t('знакомиться','meet')}</span></MotionText><MotionText as="p">{s.t('Ваши цветы, заказы и особенные моменты — в одном месте.','Your flowers, orders and special moments, together.')}</MotionText><Link className="text-link" href="/account">{s.t('Уже есть аккаунт? Войти','Already registered? Sign in')}</Link></section><section className="preview-form"><form onSubmit={submit}><h2>{s.t('Создать аккаунт','Create account')}</h2><label>{s.t('Имя и фамилия','Full name')}<input name="name" autoComplete="name" required minLength={2} maxLength={100}/></label><label>{s.t('Электронная почта','Email address')}<input name="email" type="email" autoComplete="email" required maxLength={200}/></label><label>{s.t('Телефон','Phone')}<input name="phone" type="tel" autoComplete="tel" maxLength={25}/></label>{s.segment==='b2b'&&<label>{s.t('Компания','Company')}<input name="company" autoComplete="organization" maxLength={200}/></label>}<label>{s.t('Пароль','Password')}<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128}/><small>{s.t('Не менее 8 символов','At least 8 characters')}</small></label>{error&&<MotionText as="p" role="alert" className="error-message">{error}</MotionText>}<button className="button primary" disabled={busy}>{busy?s.t('Подождите…','Please wait…'):s.t('Создать аккаунт','Create account')}</button></form></section></div></main>
}
