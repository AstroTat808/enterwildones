import { runArchiveDrill } from './_worm-archive.mjs';
export default async()=>{try{const result=await runArchiveDrill();return Response.json(result);}catch{console.error('Independent legal evidence recovery drill failed');return new Response('Archive recovery verification failed',{status:503});}};
export const config={schedule:'30 18 * * *'};
