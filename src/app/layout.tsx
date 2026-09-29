import type { Metadata } from 'next';
import './globals.css';
import MotionReveals from '@/components/motion-reveals';
import EntryTransition from '@/components/entry-transition';
import {ShopProvider} from '@/components/shop-context';
export const metadata: Metadata = {title:'Florelle — цветы вместо слов',description:'Свежие цветы от плантаций. Розница и опт, коллекции роз, пионов и гортензий. Доставка по России, Казахстану и Турции.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ru"><head>{['prata','manrope-variable','passions-conflict-rus'].map(font=><link key={font} rel="preload" href={`/fonts/${font}.woff2`} as="font" type="font/woff2" crossOrigin="anonymous"/>)}</head><body><ShopProvider><EntryTransition><MotionReveals>{children}</MotionReveals></EntryTransition></ShopProvider></body></html>}
