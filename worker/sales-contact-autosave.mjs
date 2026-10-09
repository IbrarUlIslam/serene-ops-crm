import {SALES_CONTACT_FIELDS,mergeSalesWrite,salesContactView} from './sales-access.mjs';
import {isSalesAssociate,canAccessSalesContact,canAccessSalesDeal,isAssigned} from './user-access.mjs';
import {decodeSnapshot} from './snapshot-codec.mjs';
import {writeSnapshot,snapshotEtag} from './snapshot-store.mjs';
const reply=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const comparable=value=>JSON.stringify(value===undefined?null:value);
const same=(a,b)=>comparable(a)===comparable(b);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function scopedContact(contact,db,user){return {...salesContactView(contact),assigned_to_me:isAssigned(contact,db,user,'contacts')};}
export async function handleSalesContactAutosave(request,env,user){
 if(request.method!=='PATCH')return reply({error:'Method not allowed.'},405);
 if(!isSalesAssociate(user)||!user.visibility?.sections?.includes('contacts')||!user.visibility?.editSections?.includes('contacts'))return reply({error:'Contacts are read-only for your account.'},403);
 const path=new URL(request.url).pathname.split('/').filter(Boolean),id=path[3];
 if(path.length!==4||path[0]!=='api'||path[1]!=='sales'||path[2]!=='contacts'||!id||!/^[a-zA-Z0-9_.-]{1,160}$/.test(id))return reply({error:'Choose a valid contact.'},400);
 let input;try{const text=await request.text();if(new TextEncoder().encode(text).length>100000)return reply({error:'The contact update is too large.'},413);input=JSON.parse(text);}catch{return reply({error:'Enter a valid contact update.'},400);}
 if(!object(input)||!object(input.patch)||!object(input.base)||Object.keys(input).some(key=>!['patch','base'].includes(key)))return reply({error:'Send only the changed sales fields and their original values.'},400);
 const fields=Object.keys(input.patch);
 if(!fields.length||fields.some(key=>!SALES_CONTACT_FIELDS.includes(key)||!Object.hasOwn(input.base,key))||Object.keys(input.base).some(key=>!fields.includes(key)))return reply({error:'Send only editable sales contact fields with their original values.'},400);
 for(let attempt=0;attempt<3;attempt++){
  const previous=await env.DB.prepare('SELECT data,updated_at FROM crm_snapshot WHERE org_id=?').bind(user.orgId).first();
  if(!previous)return reply({error:'The contact workspace is unavailable. Reload the CRM.'},404);
  let before;try{before=await decodeSnapshot(previous.data);}catch{return reply({error:'The stored workspace could not be read. Contact Ibrar.'},500);}
  const current=(before.contacts||[]).find(row=>row.id===id);
  if(!current||!canAccessSalesContact(current,before,user))return reply({error:'This contact is outside your sales access or has been archived.'},403);
  const conflicts=fields.filter(key=>!same(current[key],input.base[key])&&!same(current[key],input.patch[key]));
  if(conflicts.length)return reply({error:'Another user changed these contact details. Your edits are still in this window. Review the latest contact before saving.',fields:conflicts},409);
  if(fields.every(key=>same(current[key],input.patch[key])))return reply({data:{ok:true,updatedAt:previous.updated_at},contact:scopedContact(current,before,user)},200,{ETag:snapshotEtag(previous)});
  // Clone only the contact being changed; the other records remain untouched.
  const out={...before,contacts:before.contacts.map(row=>row.id===id?{...row}:row),activity:[...(before.activity||[])]};
  try{mergeSalesWrite(out,before,{contacts:[{id,...input.patch}]},user,{contactAccess:canAccessSalesContact,dealAccess:canAccessSalesDeal});}catch(error){return reply({error:error.message},403);}
  let stamp;try{stamp=await writeSnapshot(env,user.orgId,out,user.id,previous);}catch(error){if(error.code==='SNAPSHOT_TOO_LARGE')return reply({error:error.message},413);throw error;}
  if(!stamp)continue;
  return reply({data:{ok:true,updatedAt:stamp},contact:scopedContact(out.contacts.find(row=>row.id===id),out,user)},200,{ETag:JSON.stringify(stamp)});
 }
 return reply({error:'Another save is in progress. Your edits are still in this window; retry shortly.'},503);
}
