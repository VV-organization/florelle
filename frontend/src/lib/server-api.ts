import 'server-only';
export async function serverApi<T>(path:string):Promise<T>{const response=await fetch((process.env.BACKEND_URL||'http://127.0.0.1:5195')+'/api/v1'+path,{cache:'no-store'});if(!response.ok)throw new Error(`Storefront API failed (${response.status})`);return response.json();}
