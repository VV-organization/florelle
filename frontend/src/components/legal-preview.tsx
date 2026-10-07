'use client';
import {useShop} from './shop-context';
export default function LegalPreview({kind}:{kind:'privacy'|'terms'}){
 const s=useShop();
 return <main className="page-shell commerce-page"><h1>{kind==='privacy'?s.t('Политика конфиденциальности','Privacy Policy'):s.t('Пользовательское соглашение','User Agreement')}</h1></main>
}
