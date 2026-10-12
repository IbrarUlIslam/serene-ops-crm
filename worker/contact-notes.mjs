import {decodeSnapshot} from './snapshot-codec.mjs';
import {writeSnapshot} from './snapshot-store.mjs';
import {canAccessSalesContact} from './user-access.mjs';
const reply=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function handleContactNotes(request,env,user){
 if(request.method!=='POST')return reply({error:'Method not allowed.'},405);
 if(!user.isOwner&&!(user.visibility?.sections?.includes('contacts')&&user.visibility?.editSections?.includes('contacts')))return reply({error:'Notes are read-only.'},403);
 let body;try{body=await request.json();}catch{return reply({error:'Invalid note.'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Invalid note.'},400);
 const text=String(body.body||'').trim(),url=String(body.url||'').trim();
 if(!text&&!url||text.length>8000||url.length>2000||url&&!/^https?:\/\//i.test(url))return reply({error:'Enter a note or a valid http/https link.'},400);
 if(!body.key||!/^[\w-]{1,160}$/.test(body.key))return reply({error:'Reload the note form.'},400);
 for(let n=0;n<3;n++){
  const previous=await env.DB.prepare('SELECT data,updated_at FROM crm_snapshot WHERE org_id=?').bind(user.orgId).first();if(!previous)return reply({error:'Workspace unavailable.'},404);
  const db=await decodeSnapshot(previous.data),c=db.contacts?.find(c=>c.id===body.contactId);
  if(!c||c.deleted_at||c.archived_at||!canAccessSalesContact(c,db,user))return reply({error:'Contact is outside your access.'},403);
  const id='n_'+body.key,existing=db.notes?.find(x=>x.id===id);
  if(existing){if(existing.entity_type!=='contact'||existing.entity_id!==c.id||existing.by_user_id!==user.id||existing.body!==text||String(existing.url||'')!==url)return reply({error:'This note changed since its last save. Retry with a new note.'},409);return reply({ok:true,duplicate:true,note:existing});}
  const note={id,entity_type:'contact',entity_id:c.id,body:text,url,by:user.name,by_user_id:user.id,at:new Date().toISOString()};(db.notes||=[]).unshift(note);
  if(await writeSnapshot(env,user.orgId,db,user.id,previous))return reply({ok:true,note});
 }
 return reply({error:'Another save is in progress. Retry this note.'},409);
}
