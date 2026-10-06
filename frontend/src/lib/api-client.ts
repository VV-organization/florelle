export class ApiError extends Error {
 readonly status:number; readonly code:string;
 constructor(message:string,status:number,code='REQUEST_FAILED'){super(message);this.name='ApiError';this.status=status;this.code=code;}
}
export function createApiClient(fetcher:typeof fetch=fetch){
 let token:string|null=null,refreshing:Promise<boolean>|null=null;
 async function decode<T>(response:Response):Promise<T>{
  if(response.status===204)return undefined as T;
  const data=await response.json().catch(()=>null);
  if(!response.ok){const error=data?.error;throw new ApiError(typeof error==='string'?error:error?.message||data?.message||`Request failed (${response.status})`,response.status,error?.code||data?.code);}
  return data as T;
 }
 async function restore(){
  if(!refreshing)refreshing=(async()=>{try{const result=await decode<{accessToken:string}>(await fetcher('/api/v1/auth/refresh',{method:'POST',credentials:'include'}));token=result.accessToken;return true;}catch(error){token=null;if(error instanceof ApiError&&error.status===401)return false;throw error;}finally{refreshing=null;}})();
  return refreshing;
 }
 async function request<T>(path:string,init:RequestInit={},retry=true):Promise<T>{
  const headers=new Headers(init.headers);if(init.body)headers.set('Content-Type','application/json');if(token)headers.set('Authorization',`Bearer ${token}`);
  const response=await fetcher('/api/v1'+path,{...init,headers,credentials:'include',cache:'no-store'});
  if(response.status===401&&retry&&!['/auth/login','/auth/register','/auth/register/verify','/auth/logout','/auth/refresh'].includes(path)){if(await restore())return request<T>(path,init,false);}
  return decode<T>(response);
 }
 return {request,restore,setToken(value:string|null){token=value;}};
}
export const api=createApiClient();
export function safeReturn(value:string|null){return value?.startsWith('/')&&!value.startsWith('//')&&!value.includes('\\')?value:value==='checkout'?'/checkout':value==='cart'?'/cart':'/account';}
