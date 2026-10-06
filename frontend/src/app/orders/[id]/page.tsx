import {OrdersPreview} from '@/components/commerce-preview';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <OrdersPreview id={id}/>}
