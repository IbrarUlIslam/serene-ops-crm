import {mergeSalesWrite,salesContactView,salesDealView} from './sales-access.mjs';
import {inviteUser,invitationConfigured,revokeUserAccess} from './user-invitations.mjs';
import {deriveWorkTransitions} from './work-transitions.mjs';
export const SECTION_CHOICES=[['today','My work'],['calendar','Calendar'],['clients','Assigned clients'],['contacts','Contacts'],['pipeline','Deals'],['calls','Assigned calling list'],['work','Work items'],['tickets','Tickets'],['social','Social planner'],['sops','Assigned SOPs'],['meetings','Assigned meetings'],['activity','My activity']].map(([id,label])=>({id,label,editable:['contacts','pipeline','calls','work','tickets','social'].includes(id)}));
const defaults=[];
const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const norm=x=>String(x||'').trim().toLowerCase();
export const isPrimaryOwner=(u,env={})=>u?.id===(env.CRM_OWNER_USER_ID||'u_ibrar')&&u.roleCode==='owner_admin';
export const isCrmAdministrator=(u,env={})=>isPrimaryOwner(u,env)||u?.roleCode==='crm_admin';
const administratorVisibility=()=>({sections:SECTION_CHOICES.map(s=>s.id),editSections:SECTION_CHOICES.filter(s=>s.editable).map(s=>s.id),scope:'all',profile:'administrator'});
function storedVisibility(row){
 if(!row)return {sections:[],editSections:[],scope:'assigned',profile:'contributor'};
 try{const raw=JSON.parse(row.sections_json),rawEdits=JSON.parse(row.edit_sections_json);if(!Array.isArray(raw)||!Array.isArray(rawEdits))throw Error('Invalid visibility.');const sections=[...new Set(raw.filter(s=>SECTION_CHOICES.some(x=>x.id===s)))],editSections=[...new Set(rawEdits.filter(s=>sections.includes(s)&&SECTION_CHOICES.some(x=>x.id===s&&x.editable)))],profile=row.access_profile==='sales_associate'?'sales_associate':'contributor',scope='assigned';return {sections,editSections,scope,profile};}
 catch{return {sections:[],editSections:[],scope:'assigned',profile:'contributor'};}
}
export async function attachVisibility(env,u){u.isPrimaryOwner=isPrimaryOwner(u,env);u.isOwner=isCrmAdministrator(u,env);if(u.isOwner){u.visibility=administratorVisibility();if(u.isPrimaryOwner)u.visibility.profile='owner';else u.roleName='CRM administrator';return u;}let row;try{row=await env.DB.prepare('SELECT sections_json,edit_sections_json,access_profile,record_scope FROM user_visibility WHERE org_id=? AND user_id=?').bind(u.orgId,u.id).first();}catch{try{row=await env.DB.prepare('SELECT sections_json,edit_sections_json FROM user_visibility WHERE org_id=? AND user_id=?').bind(u.orgId,u.id).first();}catch{}}u.visibility=storedVisibility(row);u.roleCode=u.visibility.profile==='sales_associate'?'sales_associate':'contributor';u.roleName=u.roleCode==='sales_associate'?'Sales associate':'Assigned contributor';return u;}
export const isSalesAssociate=u=>!!u&&!u.isOwner&&(u.visibility?.profile==='sales_associate'||u.roleCode==='sales_associate');
export function canAccessSalesContact(c,db,u){return !!c&&!c.deleted_at&&!c.archived_at&&(u.isOwner||isSalesAssociate(u)&&u.visibility?.scope==='all_sales'||isAssigned(c,db,u,'contacts'));}
export function canAccessSalesDeal(d,db,u){if(!d||d.deleted_at||d.archived_at)return false;const c=(db.contacts||[]).find(c=>c.id===d.contact_id);if(!c||!canAccessSalesContact(c,db,u))return false;if(u.isOwner||isSalesAssociate(u)&&u.visibility?.scope==='all_sales')return true;const explicit=[d.assignee,d.assignee_user_id,d.assigned_to,...(d.assignees||[]),...(d.assigned_user_ids||[])].filter(Boolean);return explicit.length?isAssigned(d,db,u,'deals'):isAssigned(c,db,u,'contacts');}
export function canEditSalesPipeline(u){return !!u&&(u.isOwner||isSalesAssociate(u)&&u.visibility?.sections?.includes('pipeline')&&u.visibility?.editSections?.includes('pipeline'));}
export function canUseCallQueue(u,edit=false){return !!u&&(u.isOwner===true||(Array.isArray(u.visibility?.sections)&&u.visibility.sections.includes('calls')&&(!edit||(Array.isArray(u.visibility?.editSections)&&u.visibility.editSections.includes('calls')))));}
export async function canonicalUsers(env,org,previous=[]){let rows;try{rows=(await env.DB.prepare('SELECT u.id,u.name,u.email,u.role_id,u.status,v.access_profile FROM users u LEFT JOIN user_visibility v ON v.org_id=u.org_id AND v.user_id=u.id WHERE u.org_id=? AND u.deleted_at IS NULL ORDER BY u.created_at').bind(org).all()).results||[];}catch{rows=(await env.DB.prepare('SELECT id,name,email,role_id,status FROM users WHERE org_id=? AND deleted_at IS NULL ORDER BY created_at').bind(org).all()).results||[];}return rows.map(u=>({id:previous.find(p=>norm(p.email)===norm(u.email))?.id||u.id,auth_user_id:u.id,name:u.name,email:u.email,status:u.status,role:u.id===(env.CRM_OWNER_USER_ID||'u_ibrar')?'Owner / Admin':u.role_id==='role_crm_admin'?'CRM administrator':u.access_profile==='sales_associate'?'Sales associate':'Contributor'}));}
function identities(db,u){return new Set([u.id,u.name,u.email,...(db.users||[]).filter(x=>norm(x.email)===norm(u.email)).map(x=>x.id)].map(norm).filter(Boolean));}
export function isAssigned(row,db,u,source){const ids=identities(db,u),explicit=[row.assignee,row.assignee_user_id,row.assigned_to,...(Array.isArray(row.assignees)?row.assignees:[]),...(Array.isArray(row.assigned_user_ids)?row.assigned_user_ids:[])].filter(v=>norm(typeof v==='object'?v?.user_id||v?.id:v));const values=source&&source!=='contacts'?(explicit.length?explicit:source==='meetings'?[row.host_user_id]:[]):[...explicit,row.owner,row.owner_user_id,row.host_user_id];return values.some(v=>ids.has(norm(typeof v==='object'?v?.user_id||v?.id:v)));}
function ownRecordIdentities(row,db,u,source){
 const ids=identities(db,u),out={...row},value=v=>typeof v==='object'?v?.user_id||v?.id:v,isSelf=v=>ids.has(norm(value(v)));
 const project=v=>typeof v==='object'?{...(v.user_id?{user_id:v.user_id}:{id:v.id}),name:u.name}:v;
 for(const field of ['assignee_user_id','assigned_to','owner','owner_user_id','owner_name','host_user_id','host_name','created_by','created_by_user_id','created_by_name','createdBy','createdByName','creator','creator_user_id','creator_name','author','author_user_id','by','by_user_id','who','assigned_by','assigned_by_user_id','completed_by','completed_by_user_id','updated_by','updated_by_user_id','raised_by','raised_by_user_id','assignee_name'])if(Object.hasOwn(out,field)){if(isSelf(out[field]))out[field]=project(out[field]);else delete out[field];}
 for(const field of ['assignees','assigned_user_ids'])if(Object.hasOwn(out,field)){if(Array.isArray(out[field]))out[field]=out[field].filter(isSelf).map(project);else delete out[field];}
 // A coassigned record belongs in this view, but the labels and shortcuts
 // identify only this signed-in user. Stored assignment and authorship stay intact.
 if(source!=='contacts')out.assignee=u.name||'You';
 else if(Object.hasOwn(out,'assignee')){if(isSelf(out.assignee))out.assignee=project(out.assignee);else delete out.assignee;}
 return out;
}
// Calling rows are supplied only by the dedicated, minimal queue endpoint.
// They never expand the snapshot into a call ledger or contact directory.
const fieldsBySection={todos:'work',tickets:'tickets',social_posts:'social',meetings:'meetings',reminders:'calendar',business:'work'};
function activitySection(row,db){
 const target=row.target||{};
 if(target.section)return target.section;
 for(const [field,section]of [['tixOpen','tickets'],['meetOpen','meetings'],['mailSel','inbox']])if(target[field])return section;
 if(row.kind==='meeting')return 'meetings';if(row.kind==='mail')return 'inbox';if(row.kind==='call')return 'contacts';
 const what=String(row.what||'');
 if(/^(?:Task |Work |Timer )/i.test(what))return 'work';
 if(/^SOP /i.test(what))return 'sops';if(/^Ticket /i.test(what))return 'tickets';
 if(/^Social (?:post|account)/i.test(what))return 'social';if(/^Meeting /i.test(what))return 'meetings';
 if(/^Contact /i.test(what))return 'contacts';if(/^Client /i.test(what))return 'clients';
 if(/^View preference /i.test(what))return 'preferences';
 return null;
}
function activityFilter(db,scoped,u,can){
 const collections={work:['todos','business'],tickets:['tickets'],social:['social_posts'],sops:['sop_instances','sop_templates'],meetings:['meetings'],calendar:['reminders'],pipeline:['deals'],contacts:['contacts'],clients:['contacts']};
 const visible={};for(const [section,keys]of Object.entries(collections))visible[section]=new Set(keys.flatMap(k=>(scoped[k]||[]).filter(r=>section!=='clients'||r.status==='Client').map(r=>r.id)));
 visible.calls=new Set((db.contacts||[]).filter(c=>!c.deleted_at&&!c.archived_at&&(isSalesAssociate(u)?canAccessSalesContact(c,db,u):isAssigned(c,db,u,'contacts'))).map(c=>c.id));
 const hiddenTasks=(db.todos||[]).filter(r=>!visible.work.has(r.id));
 const hiddenTitles=new Set();for(const key of ['todos','social_posts','sop_instances','sop_templates']){const allowed=new Set((scoped[key]||[]).map(r=>r.id));for(const r of db[key]||[])if(!allowed.has(r.id)){const labels=[r.title,r.name,r.template_snapshot?.title];if(key==='sop_templates')labels.push(...(r.steps||[]).map(s=>s.title));for(const label of labels){const value=norm(label);if(value.length>=4)hiddenTitles.add(value);}}}
 const identity=identities(db,u);
 const directFields=[['taskId','work'],['todoId','work'],['workId','work'],['tixOpen','tickets'],['ticketId','tickets'],['socialPostId','social'],['sopId','sops'],['sopInstanceId','sops'],['meetOpen','meetings'],['meetingId','meetings'],['mailSel','inbox']];
 return row=>{
  if(!identity.has(norm(row.who||row.by_user_id)))return false;
  const section=activitySection(row,db);if(section==='preferences')return true;if(!can(section))return false;
  const text=norm(row.what);for(const title of hiddenTitles)if(text.includes(title))return false;
  const target=row.target||{},references=[];
  if(section==='calls'){
   const contactIds=[target.recordId,target.contactId,row.contact_id].filter(Boolean);
   if(target.callId){const call=(db.calls||[]).find(c=>c.id===target.callId);if(!call||call.queue!=='next_to_call'||!identity.has(norm(call.by_user_id||call.by||call.who)))return false;contactIds.push(call.contact_id);}
   return contactIds.length>0&&contactIds.every(id=>visible.calls.has(id))&&new Set(contactIds).size===1;
  }
  if(row.kind==='call'&&row.contact_id&&['contacts','clients'].includes(section)){const contact=(db.contacts||[]).find(c=>c.id===row.contact_id);if(!contact||!visible[section].has(contact.id)||!isAssigned(contact,db,u,'contacts'))return false;}
  if(target.recordId)references.push([target.recordId,section]);
  for(const [field,source]of directFields)if(target[field])references.push([target[field],source]);
  for(const [field,source]of [['task_id','work'],['work_item_id','work'],['ticket_id','tickets'],['social_post_id','social'],['sop_instance_id','sops'],['meeting_id','meetings']])if(row[field])references.push([row[field],source]);
  if(references.length)return references.every(([id,source])=>can(source)&&visible[source]?.has(id));
  // Older native task events contain only prose and a contact. If that contact
  // also has hidden tasks, their source cannot be recovered safely.
  if(section==='work'&&hiddenTasks.some(t=>!row.contact_id||t.contact_id===row.contact_id))return false;
  return true;
 };
}
function scopedPreferences(pref,can){const out=structuredClone(pref||{});if(!can('work'))delete out.workViews;if(!can('contacts'))delete out.contactViews;if(!can('calendar')&&!can('meetings'))delete out.calTZ;if(!can('work')&&!can('today'))delete out.focus;return out;}
export function scopeSnapshot(db,u){if(u.isOwner)return db;const can=s=>u.visibility?.sections.includes(s),out={};for(const key of Object.keys(db)){if(Array.isArray(db[key]))out[key]=[];}
 out.contacts=[];out.deals=[];out.users=(db.users||[]).filter(x=>norm(x.email)===norm(u.email));out.org={name:db.org?.name||'Serene Ops',capacity_hours:0,trigger:1};out.checklists={precall:[],onboarding:[]};out.user_prefs=Object.fromEntries(out.users.map(x=>[x.id,scopedPreferences(db.user_prefs?.[x.id],can)]));out.current_user_visibility=u.visibility;
 const related=new Set();for(const [key,section]of Object.entries(fieldsBySection)){if(!can(section))continue;out[key]=(db[key]||[]).filter(r=>!r.deleted_at&&!r.archived_at&&isAssigned(r,db,u,key)&&!(key==='todos'&&((r.social_post_id&&!can('social'))||(r.sop_instance_id&&!can('sops'))))).map(r=>ownRecordIdentities(r,db,u,key));for(const r of out[key])if(r.contact_id)related.add(r.contact_id);}
 if(can('sops')){out.sop_instances=(db.sop_instances||[]).filter(r=>!r.deleted_at&&!r.archived_at&&isAssigned(r,db,u,'sop_instances')).map(r=>ownRecordIdentities(r,db,u,'sop_instances'));const templates=new Set(out.sop_instances.map(x=>x.template_id));out.sop_templates=(db.sop_templates||[]).filter(x=>templates.has(x.id));for(const inst of out.sop_instances)if(inst.contact_id)related.add(inst.contact_id);}
 const fullContact=c=>(isSalesAssociate(u)?canAccessSalesContact(c,db,u):isAssigned(c,db,u,'contacts'))&&(can('contacts')||(can('clients')&&c.status==='Client'));
 if(isSalesAssociate(u)&&can('pipeline')){out.deals=(db.deals||[]).filter(d=>canAccessSalesDeal(d,db,u)).map(salesDealView);for(const deal of out.deals)related.add(deal.contact_id);}
 const assignedContacts=(db.contacts||[]).filter(c=>fullContact(c));for(const c of assignedContacts)related.add(c.id);
 out.contacts=(db.contacts||[]).filter(c=>!c.deleted_at&&related.has(c.id)).map(c=>{if(!fullContact(c))return {id:c.id,name:c.name,timezone:c.timezone};if(isSalesAssociate(u))return {...salesContactView(c),assigned_to_me:isAssigned(c,db,u,'contacts')};const x=ownRecordIdentities(c,db,u,'contacts');for(const k of ['monthly_override','rate_locked_until','notice_days','drive_folder_url','notes','onboarding_vault','onboarding_access_log'])delete x[k];return x;});
 if(can('calls')){const ids=new Set(assignedContacts.map(c=>c.id)),own=identities(db,u);out.calls=(db.calls||[]).filter(k=>ids.has(k.contact_id)&&k.queue==='next_to_call'&&!k.deleted_at&&!k.archived_at&&own.has(norm(k.by_user_id||k.by))).map(k=>({id:k.id,contact_id:k.contact_id,at:k.at,outcome:k.outcome,note:k.note||'',by:'You',by_user_id:u.id}));}
 if(can('contacts')){const ids=new Set(assignedContacts.map(c=>c.id));out.notes=(db.notes||[]).filter(n=>n.entity_type==='contact'&&ids.has(n.entity_id)).map(n=>({id:n.id,entity_type:n.entity_type,entity_id:n.entity_id,body:n.body||'',url:n.url||'',at:n.at,by:identities(db,u).has(norm(n.by_user_id||n.by))?'You':'Team note'}));}
 const fileContacts=new Set(assignedContacts.map(c=>c.id));
 if(!isSalesAssociate(u)&&(can('clients')||can('contacts')))out.files=(db.files||[]).filter(f=>fileContacts.has(f.contact_id)&&!f.audit_report_id&&norm(f.kind)!=='audit'&&!/^\/api\/audits\//.test(f.url||'')&&!f.social_post_id&&!f.sop_instance_id);
 if(can('activity'))out.activity=(db.activity||[]).filter(activityFilter(db,out,u,can));
 if(can('work')){const types=new Set((out.todos||[]).map(t=>t.task_type_id).filter(Boolean));out.task_types=structuredClone((db.task_types||[]).filter(t=>types.has(t.id)));}
 return structuredClone(out);
}
const writable={todos:['status','completed_at','completion_note','op_status','timer','time_logs','logged_ms','updated_at','started_at','ended_at','timer_started_at','timer_ms','minutes','note','body'],tickets:['status','status_at','closed_at','body','updated_at'],social_posts:['status','caption','updated_at']};
function validAssignedTransition(key,old,next){
 const statuses={todos:['Open','Done','Cancelled'],tickets:['Inquiry','Assigned','In progress','Waiting on client feedback','Query done']};
 if(statuses[key]&&next.status!==old.status&&!statuses[key].includes(next.status))throw Error('Choose a valid '+(key==='todos'?'work':'ticket')+' status.');
 if(key!=='todos')return;
 if(next.op_status!==old.op_status&&!['Not Started','In Progress','Waiting','Blocked','Needs Review','Complete','Cancelled'].includes(next.op_status))throw Error('Choose a valid work progress status.');
 if(old.sop_instance_id&&old.status==='Done'&&(next.status!=='Done'||(next.op_status!==old.op_status&&next.op_status!=='Complete')))throw Error('A completed SOP step cannot be reopened or cancelled. Ask Ibrar to roll back the workflow.');
}
export function mergeScopedWrite(before,incoming,u){if(u.isOwner)return incoming;const scoped=scopeSnapshot(before,u),out=structuredClone(before),edits=u.visibility?.editSections||[],can=s=>u.visibility?.sections.includes(s);for(const [key,fields]of Object.entries(writable)){const incomingRows=Array.isArray(incoming[key])?incoming[key]:[];if(!can(fieldsBySection[key])&&incomingRows.length)throw Error('This section is no longer available to your account. Reload the CRM.');if(!edits.includes(fieldsBySection[key])){const visible=new Map((scoped[key]||[]).map(r=>[r.id,r]));if(incomingRows.some(r=>{const old=visible.get(r.id);return !old||fields.some(f=>Object.hasOwn(r,f)&&JSON.stringify(r[f])!==JSON.stringify(old[f])&&(Object.hasOwn(old,f)||r[f]));}))throw Error('This section is read-only for your account.');continue;}const allowed=new Set((scoped[key]||[]).map(r=>r.id)),existing=new Set((before[key]||[]).map(r=>r.id));if(incomingRows.some(r=>existing.has(r.id)&&!allowed.has(r.id))||(key!=='todos'&&incomingRows.some(r=>!allowed.has(r.id))))throw Error('You can update only your assigned records.');const map=new Map(incomingRows.filter(r=>allowed.has(r.id)).map(r=>[r.id,r]));out[key]=(before[key]||[]).map(r=>{const change=map.get(r.id);if(!change)return r;const copy={...r};for(const f of fields)if(Object.hasOwn(change,f))copy[f]=change[f];return copy;});}
 for(const key of ['todos','tickets'])for(const r of out[key]||[]){const old=(before[key]||[]).find(x=>x.id===r.id);if(old)validAssignedTransition(key,old,r);}
 const workIds=new Set(edits.includes('work')&&can('work')?(scoped.todos||[]).map(r=>r.id):[]),ticketIds=new Set(edits.includes('tickets')&&can('tickets')?(scoped.tickets||[]).map(r=>r.id):[]);
 const allowedNew=deriveWorkTransitions(out,before,incoming,u,workIds,ticketIds);
 const existingTasks=new Set((before.todos||[]).map(r=>r.id));if((incoming.todos||[]).some(r=>!existingTasks.has(r.id)&&!allowedNew.has(r.id)))throw Error('You can update only your assigned records.');
 if(edits.includes('social')&&can('social'))for(const post of out.social_posts||[]){const old=(before.social_posts||[]).find(r=>r.id===post.id);if(old?.approval_required&&['Approved','Ready','Published'].includes(old.status)&&post.caption!==old.caption)throw Error('This caption was approved. Ask Ibrar to return the post to draft before changing it.');}
 if(edits.includes('social')&&can('social'))for(const post of out.social_posts||[]){const old=(before.social_posts||[]).find(r=>r.id===post.id);if(old&&post.status==='Published'&&old.status!=='Published'){if(old.approval_required&&!['Approved','Ready'].includes(old.status))throw Error('This post requires approval before it can be marked published.');post.published_at=new Date().toISOString();}}
 if(edits.includes('social')&&can('social'))for(const post of out.social_posts||[]){const old=(before.social_posts||[]).find(r=>r.id===post.id);if(old&&post.status!==old.status&&post.status!=='Published')throw Error('Only Ibrar can change social approval or scheduling status.');}
 for(const [key,ids,prefix,kind]of [['todos',workIds,'Task','work'],['tickets',ticketIds,'Ticket','tickets'],['social_posts',new Set(edits.includes('social')&&can('social')?(scoped.social_posts||[]).map(r=>r.id):[]),'Social post','social']])for(const r of out[key]||[]){const old=(before[key]||[]).find(x=>x.id===r.id);if(old&&ids.has(r.id)&&old.status!==r.status)(out.activity||=[]).unshift({id:'a_'+crypto.randomUUID(),at:new Date().toISOString(),who:u.name,what:prefix+' set to '+r.status,contact_id:r.contact_id||null,kind,target:{recordId:r.id,section:fieldsBySection[key]},read:false});}
 if(isSalesAssociate(u))mergeSalesWrite(out,before,incoming,u,{contactAccess:canAccessSalesContact,dealAccess:canAccessSalesDeal});
 for(const person of scoped.users||[]){const pref=incoming.user_prefs?.[person.id],visible=pref&&scopedPreferences(pref,can);if(visible&&Object.keys(visible).length)out.user_prefs={...(before.user_prefs||{}),[person.id]:{...(before.user_prefs?.[person.id]||{}),...visible}};}return out;
}
export function allowedStaffRoute(path,method='GET',user=null){
 if(path==='/api/db'||path==='/api/me'||path==='/api/auth/set-password'||path==='/api/auth/login'||path==='/api/auth/status')return true;
 if(path==='/api/contact-notes')return method==='POST'&&!!user&&(user.isOwner||isSalesAssociate(user)&&user.visibility?.sections?.includes('contacts')&&user.visibility?.editSections?.includes('contacts'));
 if(path==='/api/contact-archive')return method==='POST'&&!!user&&(user.isOwner||isSalesAssociate(user)&&user.visibility?.sections?.includes('contacts')&&user.visibility?.editSections?.includes('contacts'));
 if(/^\/api\/sales\/contacts\/[^/]+$/.test(path))return method==='PATCH'&&isSalesAssociate(user)&&user.visibility?.sections?.includes('contacts')&&user.visibility?.editSections?.includes('contacts');
 if(path==='/api/call-queue')return method==='GET'&&canUseCallQueue(user);
 if(path==='/api/call-queue/claim'||path==='/api/call-queue/release'||path==='/api/call-queue/check'||path==='/api/call-queue/outcome'||path==='/api/zoom/calls/claim')return method==='POST'&&canUseCallQueue(user,true);
 if(path==='/api/zoom/phone-mapping')return method==='GET'&&canUseCallQueue(user,true);
 return false;
}
async function body(request){const raw=await request.text();if(raw.length>12000)throw Error('Request too large.');return JSON.parse(raw);}
async function readUserPolicy(env,org,id){try{return await env.DB.prepare('SELECT sections_json,edit_sections_json,access_profile,record_scope FROM user_visibility WHERE org_id=? AND user_id=?').bind(org,id).first();}catch{return await env.DB.prepare('SELECT sections_json,edit_sections_json FROM user_visibility WHERE org_id=? AND user_id=?').bind(org,id).first();}}
export async function handleUsers(request,env,actor,services={}){
 if(!actor.isOwner)return response({error:'Only CRM administrators can manage users and visibility.'},403);
 try{
  const parts=new URL(request.url).pathname.split('/').filter(Boolean),id=parts[2];
  if(id===(env.CRM_OWNER_USER_ID||'u_ibrar')&&request.method!=='GET')return response({error:'Ibrar’s primary owner access is fixed.'},409);
  if(parts[3]==='invite'&&parts.length===4&&request.method==='POST')return response(await inviteUser(env,actor,id,{resend:(await body(request)).resend===true},services));
  if(parts.length>3)return response({error:'Not found.'},404);
  if(request.method==='GET'){
   let users;const base='SELECT u.id,u.name,u.email,u.status,u.role_id,PROFILE v.sections_json,v.edit_sections_json,i.status AS invitation_status,i.access_status,i.sent_at FROM users u LEFT JOIN user_visibility v ON v.user_id=u.id AND v.org_id=u.org_id LEFT JOIN user_invitations i ON i.user_id=u.id AND i.org_id=u.org_id WHERE u.org_id=? AND u.deleted_at IS NULL ORDER BY u.created_at';
   try{users=(await env.DB.prepare(base.replace('PROFILE','v.access_profile,v.record_scope,')).bind(actor.orgId).all()).results||[];}catch{users=(await env.DB.prepare(base.replace('PROFILE','')).bind(actor.orgId).all()).results||[];}
   return response({users:users.map(u=>{const primary=u.id===(env.CRM_OWNER_USER_ID||'u_ibrar'),administrator=primary||u.role_id==='role_crm_admin',policy=administrator?administratorVisibility():storedVisibility(u);return{...u,isOwner:administrator,isPrimaryOwner:primary,sections:policy.sections,editSections:policy.editSections,profile:primary?'owner':policy.profile,scope:policy.scope,sections_json:undefined,edit_sections_json:undefined,access_profile:undefined,record_scope:undefined};}),sections:SECTION_CHOICES,profiles:[{id:'contributor',label:'Contributor'},{id:'sales_associate',label:'Sales associate'},{id:'administrator',label:'Administrator'}],actorId:actor.id,invitationReady:invitationConfigured(env)&&!!services.sendMail,loginUrl:'https://crm.sereneop.com'});
  }
  const input=await body(request);if(input.profile==='sales_associate')input.scope='assigned';let sections=[...new Set(input.sections||[])],editSections=[...new Set(input.editSections||[])];
  if(sections.some(s=>!SECTION_CHOICES.some(x=>x.id===s))||editSections.some(s=>!sections.includes(s)||!SECTION_CHOICES.some(x=>x.id===s&&x.editable)))return response({error:'Choose valid sections and edit permissions.'},400);
  if(id===(env.CRM_OWNER_USER_ID||'u_ibrar'))return response({error:'Ibrar’s primary owner access is fixed.'},409);
  if(id===actor.id)return response({error:'Ask another administrator to change your own account access.'},409);
  const existingUser=id?await env.DB.prepare('SELECT id,email,role_id FROM users WHERE id=? AND org_id=? AND deleted_at IS NULL').bind(id,actor.orgId).first():null;
  if(id&&!existingUser)return response({error:'User not found.'},404);
  const existingPolicy=id?storedVisibility(await readUserPolicy(env,actor.orgId,id)):{profile:'contributor',scope:'assigned'};
  const profile=input.profile??(existingUser?.role_id==='role_crm_admin'?'administrator':existingPolicy.profile),scope=profile==='administrator'?'all':input.scope??existingPolicy.scope;
  if(!['contributor','sales_associate','administrator'].includes(profile)||profile!=='administrator'&&(!['assigned','all_sales'].includes(scope)||profile!=='sales_associate'&&scope!=='assigned'||profile!=='sales_associate'&&editSections.some(s=>['contacts','pipeline'].includes(s))))return response({error:'Choose a valid workspace profile and record scope.'},400);
  if(profile==='administrator'){
   if(existingUser?.role_id!=='role_crm_admin'&&input.administratorAcknowledged!==true)return response({error:'Review and approve full administrator access before saving this role.'},400);
   let role;try{role=await env.DB.prepare("SELECT id FROM roles WHERE id='role_crm_admin' AND code='crm_admin'").first();}catch{}if(!role)return response({error:'Install the CRM administrator role migration before saving this profile.'},503);
   ({sections,editSections}=administratorVisibility());
  }
  if(profile==='sales_associate'){try{await env.DB.prepare('SELECT access_profile,record_scope FROM user_visibility WHERE org_id=? LIMIT 1').bind(actor.orgId).first();}catch{return response({error:'Install the sales access migration before saving this profile.'},503);}}
  let target=id,disabledUser=null;
  if(request.method==='POST'&&!id){
   const name=String(input.name||'').trim(),email=norm(input.email);
   if(!name||name.length>120||(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)||email.length>254))return response({error:'Enter a name and valid email.'},400);
   if(await env.DB.prepare('SELECT id FROM users WHERE lower(email)=?').bind(email).first())return response({error:'That email already has a CRM account.'},409);
   if(await env.DB.prepare('SELECT id FROM users WHERE org_id=? AND lower(trim(name))=? AND deleted_at IS NULL').bind(actor.orgId,norm(name)).first())return response({error:'That display name already belongs to another CRM user. Use a distinct name so assignments stay private.'},409);
   target='u_'+crypto.randomUUID();
   const created=await env.DB.prepare("INSERT INTO users(id,org_id,name,email,role_id,status) SELECT ?,?,?,?,?,'active' WHERE NOT EXISTS (SELECT 1 FROM users WHERE org_id=? AND lower(trim(name))=? AND deleted_at IS NULL)").bind(target,actor.orgId,name,email,'role_contributor',actor.orgId,norm(name)).run();if(!created.meta?.changes)return response({error:'That display name already belongs to another CRM user.'},409);
  }else if(request.method==='PUT'&&id){
   const user=existingUser;
   if(!['active','disabled'].includes(input.status))return response({error:'Choose active or disabled.'},400);if(input.status==='disabled')disabledUser=user;
   await env.DB.prepare("UPDATE users SET status=?,role_id=?,updated_at=? WHERE org_id=? AND id=?").bind(input.status,profile==='administrator'?existingUser.role_id:'role_contributor',new Date().toISOString(),actor.orgId,id).run();
  }else return response({error:'Not found.'},404);
  const storedProfile=profile==='administrator'?'contributor':profile,storedScope=profile==='administrator'?'assigned':scope;
  try{await env.DB.prepare('INSERT INTO user_visibility(org_id,user_id,sections_json,edit_sections_json,updated_at,access_profile,record_scope) VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET sections_json=excluded.sections_json,edit_sections_json=excluded.edit_sections_json,updated_at=excluded.updated_at,access_profile=excluded.access_profile,record_scope=excluded.record_scope').bind(actor.orgId,target,JSON.stringify(sections),JSON.stringify(editSections),new Date().toISOString(),storedProfile,storedScope).run();}
  catch(error){if(storedProfile!=='contributor'||storedScope!=='assigned')throw error;await env.DB.prepare('INSERT INTO user_visibility(org_id,user_id,sections_json,edit_sections_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET sections_json=excluded.sections_json,edit_sections_json=excluded.edit_sections_json,updated_at=excluded.updated_at').bind(actor.orgId,target,JSON.stringify(sections),JSON.stringify(editSections),new Date().toISOString()).run();}
  // Grant the trusted role only after visibility persistence has succeeded.
  // A partially failed account save must never create a new administrator.
  if(profile==='administrator')await env.DB.prepare("UPDATE users SET role_id='role_crm_admin',updated_at=? WHERE org_id=? AND id=?").bind(new Date().toISOString(),actor.orgId,target).run();
  if(disabledUser)return response({ok:true,id:target,accessNotice:await revokeUserAccess(env,actor,disabledUser,services)});
  if(input.invite===true)return response(await inviteUser(env,actor,target,{},services));
  return response({ok:true,id:target,profile,scope,accessNotice:'Account and visibility saved. Use Send invitation to approve sign-in and email login instructions.'});
 }catch{return response({error:'User settings could not be saved. Check the visibility migration and try again.'},500);}
}
