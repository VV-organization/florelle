export const dynamic='force-dynamic';
export async function GET(){try{const r=await fetch((process.env.BACKEND_URL||'http://127.0.0.1:5195')+'/health/ready',{cache:'no-store'});return Response.json({status:r.ok?'ok':'unavailable'},{status:r.ok?200:503})}catch{return Response.json({status:'unavailable'},{status:503})}}
