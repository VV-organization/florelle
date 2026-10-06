import {assetPath} from '@/lib/site-path';
import type { Metadata } from 'next';
import './globals.css';
import MotionReveals from '@/components/motion-reveals';
import EntryTransition from '@/components/entry-transition';
import {serverApi} from '@/lib/server-api';
import type {Content} from '@/lib/storefront-types';
import Storefront from '@/components/storefront';
import {ShopProvider} from '@/components/shop-context';
export const metadata: Metadata = {title:'Florelle — цветы вместо слов',description:'Свежие цветы от плантаций. Розница и опт, коллекции роз, пионов и гортензий. Доставка по России, Казахстану и Турции.',icons:{icon:assetPath('/favicon.svg')}};
export default async function RootLayout({children}:{children:React.ReactNode}) {const content=await serverApi<Content>('/storefront/content?currency=RUB&lang=ru&segment=b2c');return <html lang="ru"><head>{['prata','manrope-variable','passions-conflict-rus'].map(font=><link key={font} rel="preload" href={assetPath(`/fonts/${font}.woff2`)} as="font" type="font/woff2" crossOrigin="anonymous"/>)}</head><body><style>{`:root{${['botanical-green-1920','botanical-bloom-1920','botanical-green-3072','botanical-bloom-3072'].map(name=>`--${name}:url("${content.media['/catalog/hd/'+name+'.webp'].url}")`).join(';')}}`}</style><ShopProvider initialContent={content}><EntryTransition><MotionReveals><Storefront>{children}</Storefront></MotionReveals></EntryTransition></ShopProvider></body></html>}
