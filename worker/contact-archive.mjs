import {decodeSnapshot} from './snapshot-codec.mjs';
import {checkSnapshotRevision,snapshotEtag,writeSnapshot} from './snapshot-store.mjs';
import {canAccessSalesContact,canonicalUsers,isSalesAssociate} from './user-access.mjs';

const reply=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
export const canArchiveContact=user=>!!user&&(user.isOwner===true||(isSalesAssociate(user)&&user.visibility?.sections?.includes('contacts')&&user.visibility?.editSections?.includes('contacts')));

// Archiving a sales contact preserves its linked operations and all history.
// The owner can restore the contact through Archive without reconstructing data.
export async function handleContactArchive(request,env,user){
 if(request.method!=='POST')return reply({error:'Method not allowed.'},405);
 if(!canArchiveContact(user))return reply({error:'You need permission to edit Contacts to archive a sales contact.'},403);
 let input;try{const text=await request.text();if(text.length>5000)return reply({error:'Archive request is too large.'},413);input=JSON.parse(text);}catch{return reply({error:'Enter a contact and archive reason.'},400);}
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['contactId','reason'].includes(key)))return reply({error:'Enter only the contact and archive reason.'},400);
 if(typeof input.contactId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(input.contactId))return reply({error:'Choose a valid contact.'},400);
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(!reason||reason.length>2000)return reply({error:'Enter an archive reason of up to 2,000 characters.'},400);
 const previous=await env.DB.prepare('SELECT data,updated_at FROM crm_snapshot WHERE org_id=?').bind(user.orgId).first();
 const revisionError=checkSnapshotRevision(request,previous);if(revisionError)return reply(revisionError,revisionError.status);
 let db;try{db=previous?await decodeSnapshot(previous.data):{contacts:[]};}catch{return reply({error:'Stored workspace could not be read. Contact Ibrar.'},500);}
 db.users=await canonicalUsers(env,user.orgId,db.users||[]);
 const contact=(db.contacts||[]).find(row=>row.id===input.contactId&&(!row.org_id||row.org_id===user.orgId));
 if(!contact||!canAccessSalesContact(contact,db,user))return reply({error:'This contact is unavailable or outside your sales access.'},403);
 const at=new Date().toISOString(),event={action:'Archived',at,by:user.name,by_user_id:user.id,reason};
 contact.deleted_at=at;contact.archive_reason=reason;contact.archived_by=user.name;contact.archived_by_user_id=user.id;contact.updated_at=at;
 contact.archive_history=[...(Array.isArray(contact.archive_history)?contact.archive_history:[]),event];
 const activity={id:'a_'+crypto.randomUUID(),at,who:user.name,by_user_id:user.id,what:'Contact archived: '+reason,contact_id:contact.id,kind:'archive',target:{section:'contacts',recordId:contact.id},read:false};(db.activity||=[]).unshift(activity);
 let updatedAt;try{updatedAt=await writeSnapshot(env,user.orgId,JSON.stringify(db),user.id,previous);}catch(error){if(error.code==='SNAPSHOT_TOO_LARGE')return reply({error:error.message},413);throw error;}
 if(!updatedAt)return reply({error:'The workspace changed while archiving. Reload before trying again.'},409);
 return reply({data:{ok:true,id:contact.id,reason,at,by:user.name,byUserId:user.id,activity},updatedAt},200,{ETag:snapshotEtag({updated_at:updatedAt})});
}
