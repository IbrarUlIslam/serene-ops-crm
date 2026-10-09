import {startDerivedSop} from './work-transitions.mjs';
export const DEAL_STAGES=['Demo scheduled','Audit sent','Pre-meeting prep','No show','Meeting held','Post-meeting audit sent','Initiate','Contract sent','Closed won','Closed lost'];
export const SALES_CONTACT_FIELDS=['name','brokerage','email','phone','city','state','timezone','timezone_review','tz_source','timezone_source','lead_source','status','call_start','call_end','call_days','tags','sales_notes','transactions_per_year','work_start','work_end'];
export const SALES_DEAL_FIELDS=['stage','meeting_at','meeting_tz','prep_due_at','artifact_type','artifact_minutes','next_action_at','lost_reason','checks','tags','sales_notes'];
const contactKeys=['id',...SALES_CONTACT_FIELDS,'created_at','updated_at'];
const dealKeys=['id','contact_id',...SALES_DEAL_FIELDS,'stage_at','created_at','updated_at','no_show_count'];
const pick=(row,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,structuredClone(row[key])]));
const assignmentTag=tag=>/^(?:assign(?:ed)?|owner|operator)[-_:]/i.test(String(tag));
const consentTag=tag=>['dnc','do not call','do-not-call'].includes(String(tag).trim().toLowerCase());
function preserveTags(tags,old=[],contact=false){if(tags.some(tag=>assignmentTag(tag)&&!old.includes(tag)))throw Error('Routing tags are controlled by Ibrar.');return [...new Set([...old.filter(tag=>tags.includes(tag)||assignmentTag(tag)||contact&&consentTag(tag)),...tags])];}
export const salesContactView=row=>{const out=pick(row,contactKeys);if(Array.isArray(out.tags))out.tags=out.tags.filter(tag=>!assignmentTag(tag));return out;};
export const salesDealView=row=>{const out=pick(row,dealKeys);out.scope_ready=!!String(row.scope_agreed||'').trim();if(Array.isArray(out.tags))out.tags=out.tags.filter(tag=>!assignmentTag(tag));return out;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id);
const phoneArea=value=>{const digits=String(value||'').replace(/\D/g,'');if(digits.length===10)return '1'+digits.slice(0,3);if(digits.length===11&&digits.startsWith('1'))return digits.slice(0,4);return digits.slice(0,4);};
function normalizeContactIntent(supplied,old){
 const next={...supplied};if(Array.isArray(next.tags))next.tags=preserveTags(next.tags,old?.tags||[],true);
 const zoneChanged=Object.hasOwn(next,'timezone')&&next.timezone!==old?.timezone,manualConfirmation=next.tz_source==='manual'||next.timezone_source==='manual';
 if(zoneChanged||manualConfirmation){if(next.timezone){try{new Intl.DateTimeFormat('en-US',{timeZone:next.timezone}).format();}catch{throw Error('Choose a valid timezone.');}next.timezone_review=false;next.tz_source='manual';if(Object.hasOwn(old||{},'timezone_source'))next.timezone_source='manual';else delete next.timezone_source;}else{next.timezone_review=true;next.tz_source='';if(Object.hasOwn(old||{},'timezone_source'))next.timezone_source='';}}
 else {for(const field of ['timezone_review','tz_source','timezone_source'])if(Object.hasOwn(next,field)&&!same(next[field],old?.[field]))throw Error('Choose a valid timezone before changing its verification status.');}
 if(old&&Object.hasOwn(next,'phone')&&phoneArea(next.phone)!==phoneArea(old.phone)&&/area|phone|number/i.test(old.tz_source||old.timezone_source||'')&&!zoneChanged&&!manualConfirmation){next.timezone='';next.timezone_review=true;next.tz_source='';if(Object.hasOwn(old,'timezone_source'))next.timezone_source='';}
 return next;
}
function validateContact(row,old){
 if(typeof row.name!=='string'||!row.name.trim()||row.name.length>250)throw Error('Enter a contact name.');
 if(row.status!==old?.status&&(['Client','Past client'].includes(old?.status)||!['Not contacted','Contacted','Booked'].includes(row.status)))throw Error('Sales can update prospect status. Client status is controlled by the accepted deal.');
 for(const field of SALES_CONTACT_FIELDS)if(Object.hasOwn(row,field)&&!['tags','checks','call_days','timezone_review','call_start','call_end','work_start','work_end','transactions_per_year'].includes(field)&&row[field]!=null&&(typeof row[field]!=='string'||row[field].length>(field==='sales_notes'?8000:field==='email'?254:1000)))throw Error('Enter valid sales contact details.');
 if(row.email&&!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(row.email))throw Error('Enter a valid email address.');
 if(row.timezone){try{new Intl.DateTimeFormat('en-US',{timeZone:row.timezone}).format();}catch{throw Error('Choose a valid timezone.');}}
 if(row.tags&&!Array.isArray(row.tags)||Array.isArray(row.tags)&&row.tags.some(tag=>typeof tag!=='string'||tag.length>150))throw Error('Enter valid contact tags.');
 if(row.sales_notes&&typeof row.sales_notes!=='string')throw Error('Enter valid sales notes.');
 if(row.transactions_per_year!=null&&row.transactions_per_year!==''&&!['Under 10','10 to 25','25 to 50','50+'].includes(row.transactions_per_year)&&(!Number.isFinite(Number(row.transactions_per_year))||Number(row.transactions_per_year)<0||Number(row.transactions_per_year)>100000))throw Error('Enter valid annual transactions.');
 for(const field of ['call_start','call_end','work_start','work_end'])if(row[field]!=null&&row[field]!==''&&!(typeof row[field]==='number'&&Number.isFinite(row[field])&&row[field]>=0&&row[field]<=24)&&!(typeof row[field]==='string'&&(/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(row[field])||/^\d{1,2}(?:\.\d+)?$/.test(row[field])&&Number(row[field])<=24)))throw Error('Enter valid local working or calling hours.');
 if(row.call_days!=null&&!Array.isArray(row.call_days))throw Error('Enter valid calling days.');
}
function validateDeal(row){
 if(!DEAL_STAGES.includes(row.stage))throw Error('Choose a valid deal stage.');
 if(row.meeting_tz){try{new Intl.DateTimeFormat('en-US',{timeZone:row.meeting_tz}).format();}catch{throw Error('Choose a valid meeting timezone.');}}
 for(const field of ['meeting_at','prep_due_at','next_action_at'])if(row[field]&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(row[field])||row[field]&&!Number.isFinite(Date.parse(row[field])))throw Error('Enter a date with a valid timezone.');
 for(const field of ['artifact_type','meeting_tz','lost_reason','sales_notes'])if(row[field]!=null&&(typeof row[field]!=='string'||row[field].length>8000))throw Error('Enter valid deal details.');
 if(row.artifact_minutes!=null&&(!Number.isFinite(Number(row.artifact_minutes))||Number(row.artifact_minutes)<0||Number(row.artifact_minutes)>100000))throw Error('Enter valid preparation minutes.');
 if(row.tags&&!Array.isArray(row.tags)||Array.isArray(row.tags)&&row.tags.some(tag=>typeof tag!=='string'||tag.length>150))throw Error('Enter valid deal tags.');
 if(row.checks!=null&&!object(row.checks))throw Error('Enter valid deal checklist details.');
}
function assertProtected(old,incoming,allowed,metadata){
 for(const [key,value]of Object.entries(incoming))if(!allowed.includes(key)&&!metadata.includes(key)&&(!old||!same(old[key],value)))throw Error('Sales cannot change ownership, consent, private operations, pricing or archived records.');
}

export function mergeSalesWrite(out,before,incoming,user,{contactAccess,dealAccess}){
 const can=section=>user.visibility?.sections?.includes(section),edit=section=>can(section)&&user.visibility?.editSections?.includes(section),at=new Date().toISOString();
 for(const key of ['profile','scope','roleCode','isOwner','permissions','visibility'])if(Object.hasOwn(incoming,key))throw Error('Only Ibrar can change user access.');
 if(incoming.current_user_visibility&&!same(incoming.current_user_visibility,user.visibility))throw Error('Only Ibrar can change user access.');
 const ownUsers=new Map((before.users||[]).filter(row=>String(row.email||'').toLowerCase()===String(user.email||'').toLowerCase()).map(row=>[row.id,row]));
 for(const supplied of incoming.users||[]){const old=ownUsers.get(supplied.id);if(!old||['name','email','status','role','auth_user_id'].some(key=>Object.hasOwn(supplied,key)&&!same(supplied[key],old[key])))throw Error('Only Ibrar can change user access.');}
 const oldContacts=new Map((before.contacts||[]).map(row=>[row.id,row]));
 const incomingContacts=Array.isArray(incoming.contacts)?incoming.contacts:[];
 const seen=new Set();
 for(const raw of incomingContacts){
  const supplied=normalizeContactIntent(raw,oldContacts.get(raw?.id));
  if(!safeId(supplied?.id)||seen.has(supplied.id))throw Error('Choose a valid contact.');seen.add(supplied.id);
  const old=oldContacts.get(supplied.id);
  if(old&&!contactAccess(old,before,user)){if(Object.keys(supplied).some(key=>!['id','name','timezone'].includes(key)))throw Error('This contact is outside your sales access.');continue;}
  if(!old){
   if(!edit('contacts'))throw Error('Contacts are read-only.');
   assertProtected(null,supplied,SALES_CONTACT_FIELDS,['id','created_at','updated_at']);
   const row={id:supplied.id,org_id:user.orgId,...pick(supplied,SALES_CONTACT_FIELDS),owner:user.name,owner_user_id:user.id,created_at:at,status:supplied.status||'Not contacted'};validateContact(row,null);(out.contacts||=[]).unshift(row);(out.activity||=[]).unshift({id:'a_'+crypto.randomUUID(),at,who:user.name,by_user_id:user.id,what:'Contact sales record created',contact_id:row.id,kind:'sales',target:{section:'contacts',recordId:row.id},read:false});continue;
  }
  const changes=SALES_CONTACT_FIELDS.filter(key=>Object.hasOwn(supplied,key)&&!same(old[key],supplied[key]));
  assertProtected(old,supplied,SALES_CONTACT_FIELDS,['id','created_at','updated_at','assigned_to_me']);
  if(!changes.length)continue;if(!edit('contacts'))throw Error('Contacts are read-only.');
  const row=out.contacts.find(c=>c.id===old.id);for(const key of changes)row[key]=structuredClone(supplied[key]);validateContact(row,old);row.updated_at=at;
  (out.activity||=[]).unshift({id:'a_'+crypto.randomUUID(),at,who:user.name,by_user_id:user.id,what:'Contact sales details updated',contact_id:row.id,kind:'sales',target:{section:'contacts',recordId:row.id},read:false});
 }
 const oldDeals=new Map((before.deals||[]).map(row=>[row.id,row])),seenDeals=new Set();
 for(const raw of Array.isArray(incoming.deals)?incoming.deals:[]){
  const supplied={...raw};const saved=oldDeals.get(raw?.id);if(Array.isArray(supplied.tags))supplied.tags=preserveTags(supplied.tags,saved?.tags||[]);
  if(!safeId(supplied?.id)||seenDeals.has(supplied.id))throw Error('Choose a valid deal.');seenDeals.add(supplied.id);
  const old=oldDeals.get(supplied.id);
  if(old&&!dealAccess(old,before,user))throw Error('This deal is outside your sales access.');
  assertProtected(old,supplied,SALES_DEAL_FIELDS,['id','contact_id','created_at','updated_at','stage_at','no_show_count','scope_ready']);
  if(Object.hasOwn(supplied,'scope_ready')&&supplied.scope_ready!==!!String(old?.scope_agreed||'').trim())throw Error('Written scope is controlled by Ibrar.');
  if(old&&Object.hasOwn(supplied,'contact_id')&&supplied.contact_id!==old.contact_id)throw Error('A deal cannot be moved to another contact.');
  const changed=!old||SALES_DEAL_FIELDS.some(key=>Object.hasOwn(supplied,key)&&!same(old[key],supplied[key]));
  if(!changed)continue;if(!edit('pipeline'))throw Error('Deals are read-only.');
  const row=old?out.deals.find(d=>d.id===old.id):{id:supplied.id,org_id:user.orgId,contact_id:supplied.contact_id,created_at:at,owner_user_id:user.id};
  if(!old)(out.deals||=[]).push(row);for(const field of SALES_DEAL_FIELDS)if(Object.hasOwn(supplied,field))row[field]=structuredClone(supplied[field]);if(Array.isArray(row.tags))row.tags=[...new Set([...row.tags,...(old?.tags||[]).filter(assignmentTag)])];
  const contact=out.contacts.find(c=>c.id===row.contact_id);if(!contact||!contactAccess(contact,out,user))throw Error('Choose a contact within your sales access.');validateDeal(row);
  const stageChanged=!old||row.stage!==old.stage;
  if(stageChanged&&['Contract sent','Closed won'].includes(row.stage)&&!(row.scope_agreed||'').trim())throw Error('Written scope is required before Contract sent or Closed won.');
  if(stageChanged&&row.stage==='Closed won'&&!(before.sop_instances||[]).some(inst=>inst.template_id==='sop_acceptance'&&inst.contact_id===row.contact_id&&inst.status==='Complete'&&!inst.deleted_at))throw Error('Ibrar must complete client acceptance before Closed won.');
  row.updated_at=at;if(stageChanged){row.stage_at=at;if(row.stage==='Demo scheduled'&&contact.status==='Not contacted')contact.status='Booked';if(row.stage==='Closed won')contact.status='Client';if(row.stage==='No show'){row.no_show_count=(Number(old?.no_show_count)||0)+1;if(!row.next_action_at)row.next_action_at=new Date(Date.parse(at)+2*86400000).toISOString();}
   const template={'Demo scheduled':'sop_audit','Meeting held':'sop_sales','Contract sent':'sop_acceptance','Closed won':'sop_onboarding'}[row.stage];if(template)startDerivedSop(out,template,row.contact_id,user,at);
  }
  (out.activity||=[]).unshift({id:'a_'+crypto.randomUUID(),at,who:user.name,by_user_id:user.id,what:stageChanged?'Deal moved to '+row.stage:'Deal sales details updated',contact_id:row.contact_id,kind:'sales',target:{section:'pipeline',recordId:row.id},read:false});
 }
 return out;
}
