import type {NextConfig} from 'next';
const backend=(process.env.BACKEND_URL||'http://127.0.0.1:5195').replace(/\/$/,'');
const config:NextConfig={output:'standalone',poweredByHeader:false,devIndicators:false,async rewrites(){return [{source:'/api/v1/:path*',destination:backend+'/api/v1/:path*'},{source:'/media/:path*',destination:backend+'/media/:path*'}]},outputFileTracingExcludes:{'/*':['./data/**/*','./.env*','./out/**/*']}};
export default config;
