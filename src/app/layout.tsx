import type { Metadata } from 'next';
import './globals.css';
import {ShopProvider} from '@/components/shop-context';
export const metadata: Metadata = {title:'Florelle — цветы вместо слов',description:'Свежие цветы от плантаций. Розница и опт, коллекции роз, пионов и гортензий. Доставка по России, Казахстану и Турции.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ru"><body><ShopProvider>{children}</ShopProvider></body></html>}
