import {lowCostMode} from './low-cost-policy.mjs';
import {acquireReservation,reservationFor,releaseReservation,applyReservations} from './call-reservations.mjs';
import {decodeSnapshot} from './snapshot-codec.mjs';
import {canUseCallQueue,isAssigned,isSalesAssociate,canAccessSalesContact} from './user-access.mjs';
import {snapshotEtag,writeSnapshot} from './snapshot-store.mjs';

export const CALLER_TIMEZONE='Asia/Karachi';
export const CALL_OUTCOMES=['Connected','Voicemail','No answer','Call back later','Wrong number','Do not call'];
const DAY=86400000,MINUTE=60000;
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
const fail=(message,status=400,details={})=>Object.assign(new Error(message),{status,details});
const norm=v=>String(v??'').trim().toLowerCase();
const active=c=>c&&c.status==='Client'&&!c.deleted_at&&!c.archived_at;
const SALES_STATUSES=['Not contacted','Contacted','Booked','Client'];
const salesContact=c=>c&&!c.deleted_at&&!c.archived_at&&SALES_STATUSES.includes(c.status);
const eligibleContact=c=>!!c&&!c.deleted_at&&!c.archived_at;
const visibleContact=(c,db,user)=>isSalesAssociate(user)?canAccessSalesContact(c,db,user):user.isOwner||isAssigned(c,db,user,'contacts');
const sample=r=>r?.is_sample===true||r?.sample===true||r?.audit_sample===true||r?.sample_kind||/^sample\s*[—:-]/i.test(r?.name||'');
const automatic=r=>r?.auto||r?.automated===true||r?.is_automated===true||r?.is_auto_reply===true||r?.is_newsletter===true||sample(r)||['sample','demo','synthetic','automation'].includes(norm(r?.queue));
const time=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const knownTime=(v,now)=>{const n=time(v);return n!==null&&n<=now?n:null;};
export function normalizedPhone(value){const digits=String(value??'').replace(/\D/g,'');return digits.length>=7&&digits.length<=15?digits:null;}
const phoneKey=value=>{const p=normalizedPhone(value);return p?.length===10?'1'+p:p;};
const zones=new Map();
const zone=value=>{if(typeof value!=='string'||!value.trim())return null;const key=value.trim();if(zones.has(key))return zones.get(key);let canonical=null;try{canonical=new Intl.DateTimeFormat('en-US',{timeZone:key}).resolvedOptions().timeZone;}catch{}if(zones.size>=100)zones.clear();zones.set(key,canonical);return canonical;};
const formatters=new Map(),labelFormatters=new Map(),labelCache=new Map();
function parts(at,tz){let formatter=formatters.get(tz);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});if(formatters.size>100)formatters.clear();formatters.set(tz,formatter);}return Object.fromEntries(formatter.formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
const wall=p=>Date.UTC(p.year,p.month-1,p.day,p.hour||0,p.minute||0,p.second||0);
function stamp(at,tz){const key=tz+'|'+at;if(labelCache.has(key))return labelCache.get(key);let formatter=labelFormatters.get(tz);if(!formatter){formatter=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});if(labelFormatters.size>100)labelFormatters.clear();labelFormatters.set(tz,formatter);}const label=formatter.format(new Date(at));if(labelCache.size>=1000)labelCache.clear();labelCache.set(key,label);return label;}
const localDay=(p,offset=0)=>new Date(Date.UTC(p.year,p.month-1,p.day+offset));
function instants(p,tz){
 const wanted=wall(p),offsets=new Set();for(const hours of [-36,-24,-12,0,12,24,36]){const at=wanted+hours*3600000;offsets.add(wall(parts(at,tz))-at);}
 return [...offsets].map(o=>wanted-o).filter(at=>wall(parts(at,tz))===wanted).sort((a,b)=>a-b);
}
function resolveBoundary(day,minutes,tz){
 const base=day.getTime()+minutes*MINUTE;
 // A skipped spring-forward wall time opens at the first real later minute.
 for(let shift=0;shift<=180;shift++){const d=new Date(base+shift*MINUTE),matches=instants({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes()},tz);if(matches.length)return matches;}
 return [];
}
function hour(value,fallback,end=false){if(value===null||value===undefined||value==='')return fallback;if(!['number','string'].includes(typeof value))return null;let n;if(typeof value==='string'&&/^\d{1,2}:\d{2}$/.test(value.trim())){const [h,m]=value.trim().split(':').map(Number);if(m>59)return null;n=h*60+m;}else{const v=Number(value);if(!Number.isFinite(v))return null;n=v*60;if(Math.abs(n-Math.round(n))>0.00001)return null;n=Math.round(n);}return n>=0&&n<=(end?1440:1439)?n:null;}
const DAY_NAMES=['sun','mon','tue','wed','thu','fri','sat'];
function days(value){if(value===undefined||value===null||value==='')return [1,2,3,4,5];if(!Array.isArray(value))return null;const result=[];for(const item of value){const n=typeof item==='number'?item:DAY_NAMES.indexOf(norm(item).slice(0,3));if(!Number.isInteger(n)||n<0||n>6)return null;if(!result.includes(n))result.push(n);}return result.length?result.sort():null;}
export function callingWindow(contact){const timezone=contact.timezone_review===true?null:zone(contact.timezone),start=hour(contact.call_start,540),end=hour(contact.call_end,1080,true),allowedDays=days(contact.call_days);if(!timezone)return {error:'timezone_unknown',message:'Confirm a valid contact timezone before calling.'};if(start===null||end===null||start===end||!allowedDays)return {error:'calling_hours_invalid',message:'Review the contact calling hours and days before calling.'};return {timezone,start,end,days:allowedDays,overnight:end<start,source:contact.call_start==null&&contact.call_end==null&&contact.call_days==null?'default':'contact'};}
const clockValue=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
function localAllowed(at,window){const p=parts(at,window.timezone),minute=p.hour*60+p.minute,weekday=localDay(p).getUTCDay();if(!window.overnight)return window.days.includes(weekday)&&minute>=window.start&&minute<window.end;return (window.days.includes(weekday)&&minute>=window.start)||(window.days.includes((weekday+6)%7)&&minute<window.end);}
export function nextCallingWindow(contact,at){
 const window=callingWindow(contact);if(window.error)return window;const p=parts(at,window.timezone),candidates=[];
 for(let offset=-1;offset<=15;offset++){const day=localDay(p,offset);if(!window.days.includes(day.getUTCDay()))continue;const starts=resolveBoundary(day,window.start,window.timezone),ends=resolveBoundary(day,window.end+(window.overnight?1440:0),window.timezone);for(const start of starts)for(const end of ends){if(end<=start||end<=at)continue;let opening=Math.max(start,at);if(!localAllowed(opening,window)){
   // The autumn repeated hour can temporarily return the clock before the
   // configured start. Never mark that interval callable just from UTC bounds.
   opening=Math.ceil(opening/MINUTE)*MINUTE;for(let n=0;n<=180&&opening<end&&!localAllowed(opening,window);n++)opening+=MINUTE;
  }if(opening<end&&localAllowed(opening,window))candidates.push({at:opening,start,end});}if(candidates.length){candidates.sort((a,b)=>a.at-b.at||a.end-b.end);return {...window,...candidates[0]};}}
 return {...window,error:'calling_window_unavailable',message:'No valid calling window could be calculated. Review the client hours.'};
}
const belongs=(r,id)=>(r?.matched_contact_id||r?.contact_id)===id;
function blockedConsent(contact){const tags=Array.isArray(contact.tags)?contact.tags:String(contact.tags||'').split(',');return !!(contact.status==='DNC'||contact.consent_withdrawn_at||contact.do_not_call||contact.dnc||contact.call_blocked||contact.doNotCall||norm(contact.consent_status)==='withdrawn'||tags.some(t=>['dnc','do not call','do-not-call'].includes(norm(t))));}
function blockedCallingPhones(db,now){
 // Consent follows the number across duplicate, archived and historical records.
 // Prepare once for a full queue; no hidden record labels leave this module.
 const blocked=new Set(),consentByPhone=new Map(),contacts=new Map((db.contacts||[]).map(c=>[c.id,c]));
 for(const contact of contacts.values()){
  if(sample(contact))continue;const key=phoneKey(contact.phone);if(!key)continue;
  if(blockedConsent(contact))blocked.add(key);
  const consent=knownTime(contact.consent_given_at,now);if(consent!==null)consentByPhone.set(key,Math.max(consentByPhone.get(key)??-Infinity,consent));
 }
 for(const call of db.calls||[]){
  const at=knownTime(call.at,now);if(call.outcome!=='Do not call'||automatic(call)||at===null)continue;
  const contact=contacts.get(call.matched_contact_id||call.contact_id);if(sample(contact))continue;
  // A retained original dial number stays protected if the contact is later
  // edited. The linked contact also retains its prior consent restriction.
  const keys=new Set([phoneKey(call.number),phoneKey(contact?.phone)].filter(Boolean));
  for(const key of keys)if((consentByPhone.get(key)??-Infinity)<=at)blocked.add(key);
 }
 return blocked;
}
function restriction(contact,db,now,user,blockedPhones){if(!eligibleContact(contact,user))return ['archived_contact','Archived contacts are excluded from calling.'];if(contact.status==='Not interested')return ['not_interested','This contact is marked Not interested.'];if(sample(contact))return ['sample_contact','Fictional samples are excluded from calling.'];if(!normalizedPhone(contact.phone))return ['missing_phone','Add and verify a valid phone number before calling.'];if(contact.consent_withdrawn_at)return ['consent_withdrawn','Calling consent has been withdrawn.'];if(blockedConsent(contact)||(blockedPhones||blockedCallingPhones(db,now)).has(phoneKey(contact.phone)))return ['do_not_call','Calling is restricted for this phone number. Ibrar must review its consent records before calling.'];return null;}
function recordedHistory(db,contact,now,meetingRows){
 const calls=(db.calls||[]).filter(r=>belongs(r,contact.id)&&!r.deleted_at&&!r.archived_at&&!automatic(r)&&knownTime(r.at,now)!==null).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 const events=calls.filter(r=>r.outcome==='Connected').map(r=>({at:time(r.at),kind:'conversation'}));let emailCount=0,meetingCount=0;
 for(const email of [...(db.emails||[]),...(db.email_exchanges||[])]){
  if(!belongs(email,contact.id)||email.deleted_at||email.archived_at||automatic(email))continue;
  const providerId=email.zoho_message_id||email.provider_message_id||(['zoho','gmail','outlook'].includes(norm(email.provider||email.source))&&email.message_id);if(!providerId)continue;
  const incoming=['incoming','inbound'].includes(norm(email.direction)),reply=email.in_reply_to||email.reply_to_message_id;
  const received=incoming?knownTime(email.received_at||email.provider_received_at,now):null,replied=reply?knownTime(email.replied_at||(norm(email.direction)==='outbound'?email.sent_at:null),now):null;
  const at=Math.max(received??-Infinity,replied??-Infinity);if(Number.isFinite(at)){events.push({at,kind:'email exchange'});emailCount++;}
 }
 const canonicalMeetings=new Map([...(db.meetings||[]),...meetingRows].map((m,i)=>[m.zoom_meeting_id||m.id||'anonymous_'+i,m]));for(const meeting of canonicalMeetings.values()){
  if(!belongs(meeting,contact.id)||meeting.deleted_at||meeting.archived_at||automatic(meeting))continue;
  const ended=norm(meeting.zoom_status)==='ended'||['completed','complete','done'].includes(norm(meeting.status));if(!ended)continue;
  const at=knownTime(meeting.meeting_ended_at||meeting.completed_at||meeting.ended_at,now);if(at!==null){events.push({at,kind:'completed meeting'});meetingCount++;}
 }
 events.sort((a,b)=>b.at-a.at);const last=events[0]||null,created=knownTime(contact.created_at,now),baseline=last?.at??created??(calls.length?time(calls.at(-1).at):null),historyState=last?'recorded':baseline!==null?'never_contacted':'unknown';
 return {last,calls,lastAttempt:calls[0]||null,baseline,historyState,emailCount,meetingCount};
}
function callbackFor(db,contact,now){return (db.reminders||[]).filter(r=>belongs(r,contact.id)&&!r.done&&!r.deleted_at&&!r.archived_at&&!sample(r)&&(norm(r.kind)==='call'||r.call_queue_callback===true)&&time(r.at)!==null&&!(db.calls||[]).some(call=>belongs(call,contact.id)&&!automatic(call)&&knownTime(call.at,now)!==null&&Date.parse(call.at)>=Date.parse(r.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))[0]||null;}
function publicHistoryKind(kind,user){if(user.isOwner)return kind;if(kind==='completed meeting'&&!user.visibility?.sections?.includes('meetings'))return 'recorded interaction';if(kind==='email exchange'&&!user.visibility?.sections?.includes('inbox'))return 'recorded interaction';return kind;}
function rowFor(db,contact,now,inactivityDays,user,meetingRows,duplicatePhones,windowCache){
 const window=callingWindow(contact),history=recordedHistory(db,contact,now,meetingRows),callback=callbackFor(db,contact,now),callbackAt=callback?time(callback.at):null,lastAttemptAt=history.lastAttempt?time(history.lastAttempt.at):null;
 const firstSalesOutreach=contact.status!=='Client'&&!history.last;
 const cooldownUntil=lastAttemptAt!==null&&history.lastAttempt.outcome!=='Connected'?lastAttemptAt+DAY:null;
 const dueCallback=callbackAt!==null&&callbackAt<=now,eligibleSince=history.baseline===null?null:history.baseline+inactivityDays*DAY;
 const row={contactId:contact.id,name:contact.name||'Contact',status:contact.status,firstSalesOutreach,phone:contact.phone,phoneNormalized:normalizedPhone(contact.phone),timezone:window.timezone||contact.timezone||null,localNow:window.timezone?stamp(now,window.timezone):null,pktNow:stamp(now,CALLER_TIMEZONE),windowStart:window.start!==undefined?clockValue(window.start):null,windowEnd:window.end!==undefined?clockValue(window.end):null,windowDays:window.days||null,windowSource:window.source||null,opensAt:null,closesAt:null,opensLocal:null,opensPKT:null,closesLocal:null,closesPKT:null,windowClosingMinutes:null,lastMeaningfulAt:history.last?new Date(history.last.at).toISOString():null,lastMeaningfulKind:publicHistoryKind(history.last?.kind||null,user),historyState:history.historyState,historyLabel:history.historyState==='recorded'?'Recorded meaningful contact':history.historyState==='never_contacted'?'No meaningful contact recorded':'Contact-history baseline unknown',inactiveDays:history.baseline===null?null:Math.floor((now-history.baseline)/DAY),lastAttemptAt:lastAttemptAt===null?null:new Date(lastAttemptAt).toISOString(),cooldownUntil:cooldownUntil!==null&&cooldownUntil>now?new Date(cooldownUntil).toISOString():null,callbackAt:callbackAt===null?null:new Date(callbackAt).toISOString(),dueCallback,availableNow:false,reasonCodes:[],reasons:[]};
 const review=(code,message)=>({...row,bucket:'review',reasonCodes:[code],reasons:[message]});
  if(window.error)return review(window.error,window.message);
 if((db.reminders||[]).some(r=>belongs(r,contact.id)&&!r.done&&!r.deleted_at&&!r.archived_at&&!sample(r)&&(norm(r.kind)==='call'||r.call_queue_callback===true)&&time(r.at)===null))return review('callback_time_invalid','A pending callback has an invalid or missing timezone/date. Confirm its intended time before calling.');
 if(duplicatePhones.has(phoneKey(contact.phone)))return review('duplicate_phone','This phone number is shared by more than one eligible contact record. Confirm the correct record before calling.');
 if(history.lastAttempt?.outcome==='Wrong number'&&phoneKey(history.lastAttempt.number||contact.phone)===phoneKey(contact.phone))return review('wrong_number','The latest recorded attempt marked this number wrong. Verify or update the number before calling.');
 if(inactivityDays>0&&history.baseline===null&&!callback&&!firstSalesOutreach)return review('history_unknown','No valid creation date or recorded contact baseline is available. Review the history before calling.');
 let earliest=now;
 if(callbackAt!==null){earliest=Math.max(earliest,callbackAt);row.reasonCodes.push(dueCallback?'callback_due':'callback_scheduled');row.reasons.push(dueCallback?'A recorded callback is due.':'Wait until the recorded callback time.');}
 else if(firstSalesOutreach){row.reasonCodes.push('sales_outreach_ready');row.reasons.push('No meaningful conversation is recorded. Review the prospect context before an initial sales call.');}
 else if(inactivityDays>0&&eligibleSince>now){earliest=eligibleSince;row.reasonCodes.push('recent_meaningful_contact');row.reasons.push(history.last?'Meaningful contact was recorded within the selected inactivity period.':'This client was created within the selected inactivity period.');}
 else{row.reasonCodes.push('inactive');row.reasons.push(history.last?'No meaningful contact recorded for '+inactivityDays+' days.':'No meaningful contact recorded since the available history baseline.');}
 // The earliest time already includes a future callback's due time, when it
 // will supersede cooldown. Its presence never permits calling before due.
 if(callbackAt===null&&cooldownUntil!==null&&cooldownUntil>earliest){earliest=cooldownUntil;row.reasonCodes.push('attempt_cooldown');row.reasons.push('Wait 24 hours after the last unsuccessful attempt unless an explicit callback is due.');}
 const windowKey=JSON.stringify([window.timezone,window.start,window.end,window.days,earliest]);let next=windowCache.get(windowKey);if(!next){next=nextCallingWindow(contact,earliest);windowCache.set(windowKey,next);}if(next.error)return review(next.error,next.message);
 if(next.at>earliest){row.reasonCodes.push('outside_calling_hours');row.reasons.push('Wait for the next permitted local calling window.');}
 row.availableNow=next.at<=now;row.opensAt=new Date(row.availableNow?next.start:next.at).toISOString();row.closesAt=new Date(next.end).toISOString();row.opensLocal=stamp(row.availableNow?next.start:next.at,next.timezone);row.opensPKT=stamp(row.availableNow?next.start:next.at,CALLER_TIMEZONE);row.closesLocal=stamp(next.end,next.timezone);row.closesPKT=stamp(next.end,CALLER_TIMEZONE);row.windowClosingMinutes=row.availableNow?Math.max(0,Math.ceil((next.end-now)/MINUTE)):null;row.bucket=row.availableNow?'available':'upcoming';return row;
}
function orderAvailable(a,b){return Number(b.dueCallback)-Number(a.dueCallback)||(a.dueCallback&&b.dueCallback?Date.parse(a.callbackAt)-Date.parse(b.callbackAt):0)||(a.windowClosingMinutes??Infinity)-(b.windowClosingMinutes??Infinity)||(a.inactiveDays===null?0:b.inactiveDays===null?0:b.inactiveDays-a.inactiveDays)||a.name.localeCompare(b.name)||a.contactId.localeCompare(b.contactId);}
export function buildCallQueue(db,user,now,inactivityDays=0,meetingRows=[],targetId=null,preparedConsentPhones=null){
 const sales=isSalesAssociate(user),contacts=(db.contacts||[]).filter(c=>eligibleContact(c,user)),seen=new Map(),windowCache=new Map();for(const c of contacts){if(sample(c))continue;const key=phoneKey(c.phone);if(key)seen.set(key,(seen.get(key)||0)+1);}const duplicates=new Set([...seen].filter(([,count])=>count>1).map(([key])=>key));
 const queue={available:[],upcoming:[],review:[],queueMode:'contacts',queueTitle:'Next to call',contactScope:sales?(user.visibility?.scope==='all_sales'?'all_sales':'assigned'):(user.isOwner?'all_contacts':'assigned'),eligibleStatuses:[...new Set(contacts.map(c=>c.status).filter(Boolean))],serverNow:new Date(now).toISOString(),callerTimezone:CALLER_TIMEZONE,inactivityDays,canCall:canUseCallQueue(user,true),canLog:canUseCallQueue(user,true),outcomes:CALL_OUTCOMES,historyCoverage:{label:'Based on recorded CRM history. Live inbox activity is not included.',calls:'Saved manual call outcomes. Only Connected counts as a meaningful conversation.',emails:'Only contact-linked provider records with an actual incoming/reply timestamp count.'+' The live Zoho inbox is not included.',meetings:'Only recorded completed meetings with an actual end/completion timestamp count. Scheduled meetings do not count.',includesLiveInbox:false,includesZoomCallEvents:false},excluded:{sample:0,missingPhone:0,withdrawn:0,doNotCall:0}};
 const consentPhones=preparedConsentPhones||blockedCallingPhones(db,now);
 for(const c of contacts){if(targetId&&c.id!==targetId)continue;if(!visibleContact(c,db,user))continue;const blocked=restriction(c,db,now,user,consentPhones);if(blocked){const key={sample_contact:'sample',missing_phone:'missingPhone',consent_withdrawn:'withdrawn',do_not_call:'doNotCall'}[blocked[0]];if(key)queue.excluded[key]++;continue;}const row=rowFor(db,c,now,inactivityDays,user,meetingRows,duplicates,windowCache);queue[row.bucket].push(row);}
 queue.available.sort(orderAvailable);queue.upcoming.sort((a,b)=>Date.parse(a.opensAt)-Date.parse(b.opensAt)||orderAvailable(a,b));queue.review.sort((a,b)=>a.name.localeCompare(b.name)||a.contactId.localeCompare(b.contactId));return queue;
}
async function input(request){const raw=await request.text();if(raw.length>16000)throw fail('Request is too large.',413);try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw fail('Invalid JSON body.');}}
function period(value){if(value===undefined||value===null||value==='')return 0;const n=Number(value);if(![0,7,14,30].includes(n))throw fail('Choose all contacts or an inactivity period of 7, 14 or 30 days.');return n;}
const readCaches=new WeakMap();
async function load(env,org,readOnly=false){const row=await env.DB.prepare('SELECT data,updated_at FROM crm_snapshot WHERE org_id=?').bind(org).first();if(!row)throw fail('Open the CRM workspace before using the calling queue.',409);let cache;if(readOnly){cache=readCaches.get(env.DB);if(!cache){cache=new Map();readCaches.set(env.DB,cache);}const hit=cache.get(org);if(hit&&hit.data===row.data&&hit.version===row.updated_at)return {row,db:hit.db};}let db;try{db=await decodeSnapshot(row.data);if(!db||!Array.isArray(db.contacts))throw Error();}catch{throw fail('The workspace contact list could not be read. Contact Ibrar.',503);}if(cache){if(cache.size>=2)cache.clear();cache.set(org,{data:row.data,version:row.updated_at,db});}return {row,db};}
async function meetings(env,org){try{return (await env.DB.prepare('SELECT * FROM zoom_crm_meetings WHERE org_id=?').bind(org).all()).results||[];}catch{return [];}}
function assignedContact(db,user,id){if(typeof id!=='string'||!id)throw fail('Choose a contact.');const c=(db.contacts||[]).find(c=>c.id===id);if(!c||!visibleContact(c,db,user))throw fail('Contact not found or outside your calling scope.',404);return c;}
async function fingerprint(payload){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
function replay(db,key,user,hash){const existing=(db.calls||[]).find(c=>c.queue==='next_to_call'&&c.idempotency_key===key);if(!existing)return null;if(existing.by_user_id!==user.id||existing.idempotency_fingerprint!==hash)throw fail('This call identifier is already used for a different outcome. Start a new logging action.',409);return existing;}
function clock(services){const now=typeof services.now==='function'?services.now():services.now??Date.now(),value=now instanceof Date?now.getTime():typeof now==='string'?Date.parse(now):now;if(!Number.isFinite(value))throw fail('Server time is unavailable.',503);return value;}
export async function handleCallQueue(request,env,user,services={}){
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/call-queue/,'');
 try{
  const reading=path===''&&request.method==='GET',checking=path==='/check'&&request.method==='POST',logging=path==='/outcome'&&request.method==='POST',claiming=path==='/claim'&&request.method==='POST',releasing=path==='/release'&&request.method==='POST';
  if(!reading&&!checking&&!logging&&!claiming&&!releasing)throw fail('Not found.',404);
  if(!canUseCallQueue(user,!reading))throw fail('Calling access is not enabled for your account.',403);
  const body=reading?{}:await input(request),inactivityDays=period(reading?url.searchParams.get('inactivityDays'):body.inactivityDays),now=clock(services),loaded=await load(env,user.orgId,reading),{db,row}=loaded;
  if(reading){const queue=buildCallQueue(db,user,now,inactivityDays,await meetings(env,user.orgId));if(lowCostMode(env))await applyReservations(env,queue,user,now);return json({...queue,snapshotVersion:row.updated_at??null},200,{ETag:snapshotEtag(row)});}
  const contact=assignedContact(db,user,body.contactId);
  if(releasing){if(lowCostMode(env))await releaseReservation(env,user.orgId,contact.id,user.id);return json({ok:true});}
  if(claiming&&!lowCostMode(env))throw fail('Contact reservations are not enabled.',409);
  if(checking||claiming){const consentPhones=blockedCallingPhones(db,now),blocked=restriction(contact,db,now,user,consentPhones);if(blocked)return json({eligible:false,error:blocked[1],reasonCodes:[blocked[0]],reasons:[blocked[1]]},409,{ETag:snapshotEtag(row)});const queue=buildCallQueue(db,user,now,inactivityDays,await meetings(env,user.orgId),contact.id,consentPhones),current=[...queue.available,...queue.upcoming,...queue.review].find(c=>c.contactId===contact.id);if(!current?.availableNow)return json({eligible:false,error:current?.reasons.join(' ')||'This contact is not currently eligible to call.',contact:current,reasonCodes:current?.reasonCodes||[],reasons:current?.reasons||[]},409,{ETag:snapshotEtag(row)});if(lowCostMode(env)&&!(await acquireReservation(env,user.orgId,contact.id,user.id,now)))throw fail('Another associate has reserved this contact. Refresh the list before calling.',409);return json({eligible:true,reservedUntil:lowCostMode(env)?new Date(now+15*MINUTE).toISOString():null,contact:current,idempotencyKey:crypto.randomUUID(),checkedAt:new Date(now).toISOString(),snapshotVersion:row.updated_at??null,inactivityDays,queueMode:queue.queueMode},200,{ETag:snapshotEtag(row)});}
  if(!eligibleContact(contact,user)||sample(contact))throw fail('Outcomes can be recorded only for a non-archived contact within your calling scope.',409);
  if(!CALL_OUTCOMES.includes(body.outcome))throw fail('Choose a valid call outcome.');
  const key=String(body.idempotencyKey||'');if(!/^[a-zA-Z0-9_-]{16,100}$/.test(key))throw fail('A valid call identifier is required. Retry the same logging action.');
  const note=String(body.note||'').trim();if(note.length>4000)throw fail('Call notes must be 4,000 characters or fewer.');if(['Call back later','Wrong number','Do not call'].includes(body.outcome)&&!note)throw fail('Add a note explaining this outcome.');
  let callbackAt=null;if(body.callbackAt){const at=time(body.callbackAt);if(at===null)throw fail('Choose a callback using a valid date and timezone.');if(!['Connected','Call back later'].includes(body.outcome))throw fail('A callback time can be recorded with Connected or Call back later.');callbackAt=new Date(at).toISOString();}
  if(body.outcome==='Call back later'&&!callbackAt)throw fail('Choose the requested callback time.');
  const payload={contactId:contact.id,outcome:body.outcome,note,callbackAt},hash=await fingerprint(payload),prior=replay(db,key,user,hash);if(prior)return json({ok:true,duplicate:true,call:prior,updatedAt:row.updated_at??null},200,{ETag:snapshotEtag(row)});
  if(lowCostMode(env)){const held=await reservationFor(env,user.orgId,contact.id,now);if(held&&held.user_id!==user.id)throw fail('Another associate has reserved this contact. Your outcome draft is retained; ask them to release it or wait for expiry.',409);}
  if(callbackAt&&(Date.parse(callbackAt)<=now||Date.parse(callbackAt)>now+366*DAY))throw fail('Choose a future callback within the next year using a date and timezone.');
  // Outcomes describe an already completed manual attempt. Hours and inactivity
  // are checked before dispatch, not at logging (a call can cross its close).
  // Current permission scope and eligible contact status remain mandatory. Do not copy any
  // supplied user/phone/contact/status fields into the canonical workspace.
  const stamp=new Date(now).toISOString(),call={id:'k_call_'+crypto.randomUUID(),contact_id:contact.id,at:stamp,outcome:body.outcome,note,by_user_id:user.id,by:user.name||user.email||user.id,queue:'next_to_call',queue_mode:'contacts',number:contact.phone||'',idempotency_key:key,idempotency_fingerprint:hash,meaningful_contact:body.outcome==='Connected'};
  (db.calls||=[]).unshift(call);
  for(const reminder of db.reminders||[])if(belongs(reminder,contact.id)&&!reminder.done&&(norm(reminder.kind)==='call'||reminder.call_queue_callback===true)&&time(reminder.at)!==null&&time(reminder.at)<=now&&(user.isOwner||isAssigned(reminder,db,user,'reminders'))){reminder.done=true;reminder.completed_at=stamp;}
  if(callbackAt)(db.reminders||=[]).unshift({id:'r_call_'+crypto.randomUUID(),contact_id:contact.id,kind:'Call',title:'Call back: '+(contact.name||'Client'),at:callbackAt,timezone:zone(contact.timezone),assignee_user_id:user.id,assignee:user.name||user.email||user.id,done:false,call_queue_callback:true,call_id:call.id});
  if(body.outcome==='Do not call'){contact.do_not_call=true;contact.consent_withdrawn_at=stamp;contact.do_not_call_at=stamp;contact.do_not_call_by=user.id;}
  (db.activity||=[]).unshift({id:'a_call_'+crypto.randomUUID(),at:stamp,who:user.name||user.email||user.id,by_user_id:user.id,what:'Call outcome recorded: '+body.outcome,kind:'call',contact_id:contact.id,target:{section:'calls',recordId:contact.id,callId:call.id},read:false});
  const updatedAt=await writeSnapshot(env,user.orgId,JSON.stringify(db),user.id,row);
  if(!updatedAt){const fresh=await load(env,user.orgId);assignedContact(fresh.db,user,contact.id);const duplicated=replay(fresh.db,key,user,hash);if(duplicated)return json({ok:true,duplicate:true,call:duplicated,updatedAt:fresh.row.updated_at??null},200,{ETag:snapshotEtag(fresh.row)});throw fail('The workspace changed while recording the call. Refresh and retry this same outcome; your draft is not saved yet.',409,{retrySameIdentifier:true});}
  if(lowCostMode(env))await releaseReservation(env,user.orgId,contact.id,user.id).catch(()=>{});
  return json({ok:true,duplicate:false,call,updatedAt},200,{ETag:JSON.stringify(updatedAt)});
 }catch(error){return json({error:error.status?error.message:'The calling queue is unavailable. Refresh or contact Ibrar.',...(error.details||{})},error.status||503);}
}
