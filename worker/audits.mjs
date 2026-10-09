import {decodeSnapshot} from './snapshot-codec.mjs';
import {canEditSalesPipeline,canAccessSalesDeal} from './user-access.mjs';
import {analyzePublic} from './audit-analysis.mjs';
import {handleAuditConnectors,targetInput,SOURCES} from './audit-connectors.mjs';
import {QUESTIONS,SERVICES,validateAnswers,buildReport,reportHtml,newDemoDeals} from './audit-report.mjs';
import {writeSnapshot} from './snapshot-store.mjs';
import {SAMPLE_CONTACT_ID,SAMPLE_DEAL_ID,SAMPLE_ANSWERS,SAMPLE_SERVICES,SAMPLE_SERVICE_NOTES,isSampleCase,isSampleContact,sampleContact,sampleEvidence,labelSampleReport} from './audit-sample.mjs';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
const stmt=(env,sql,...values)=>env.DB.prepare(sql).bind(...values);
async function snapshot(env,org){const r=await stmt(env,'SELECT data FROM crm_snapshot WHERE org_id=?',org).first();return r?await decodeSnapshot(r.data):{contacts:[],deals:[]};}
function contactFor(db,id){const c=(db.contacts||[]).find(c=>c.id===id&&!c.deleted_at);if(!c)throw error('Contact not found or archived.',404);return c;}
async function caseFor(env,org,id){const row=await stmt(env,'SELECT * FROM audit_cases WHERE org_id=? AND id=?',org,id).first();if(!row)throw error('Audit not found.',404);return row;}
function unpack(row){return {...row,sample:isSampleCase(row),answers:JSON.parse(row.answers_json),services:JSON.parse(row.services_json),evidence:JSON.parse(row.evidence_json),answers_json:undefined,services_json:undefined,evidence_json:undefined};}
async function readInput(request){const raw=await request.text();if(raw.length>100000)throw error('Request is too large.',413);try{return JSON.parse(raw);}catch{throw error('Invalid JSON.');}}
function expectRevision(row,input){if(!Number.isInteger(input.revision)||row.revision!==input.revision)throw error('This audit changed in another window. Reload before saving.',409);}
async function connector(env,user,source,target,id,allowPaid){const request=new Request('https://crm.internal/api/audit-connectors/collect',{method:'POST',body:JSON.stringify({source,target,runId:id,allowPaid})});const resp=await handleAuditConnectors(request,env,user);const body=await resp.json();return body.result||{source,status:'not_assessed',collectedAt:now(),evidence:[],note:body.error||'Collection is pending. Check provider status before retrying.'};}
async function saveReport(env,row,kind,contact){
 const existing=await stmt(env,'SELECT report_json FROM audit_reports WHERE org_id=? AND audit_id=? AND kind=? AND revision=?',row.org_id,row.id,kind,row.revision).first();if(existing)return JSON.parse(existing.report_json);
 let report=buildReport(kind,contact,JSON.parse(row.evidence_json),JSON.parse(row.answers_json),JSON.parse(row.services_json),row.service_notes,now());
 if(isSampleContact(contact))report=labelSampleReport(report);
 else try{const previous=kind==='full'?await stmt(env,"SELECT report_json FROM audit_reports WHERE org_id=? AND audit_id=? AND kind='pre' ORDER BY created_at DESC LIMIT 1",row.org_id,row.id).first():null;const pre=previous?JSON.parse(previous.report_json):null;report.analysis=pre?.analysis&&JSON.stringify(pre.evidence)===JSON.stringify(report.evidence)?pre.analysis:await analyzePublic(env,report.evidence);report.method='Prepared from dated public evidence and saved meeting answers. AI-assisted public analysis is checked for literal source quotations and must be reviewed before sending. Private operations use realtor-provided answers, not public inference.';}catch{report.analysis={sections:[],sources:[],generated:false,note:'Detailed analysis did not complete. Review saved evidence and regenerate after confirming the analysis service.'};}
 const id=crypto.randomUUID();await stmt(env,'INSERT INTO audit_reports (id,org_id,audit_id,contact_id,kind,revision,report_json,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(org_id,audit_id,kind,revision) DO NOTHING',id,row.org_id,row.id,row.contact_id,kind,row.revision,JSON.stringify(report),report.createdAt).run();return report;
}
export async function mergeAuditDocuments(env,org,files=[]){
 const rows=(await stmt(env,'SELECT id,audit_id,contact_id,kind,revision,created_at FROM audit_reports WHERE org_id=? ORDER BY created_at DESC',org).all()).results||[];
 return [...files.filter(f=>!f.audit_report_id),...rows.map(r=>({id:'audit-report:'+r.id,contact_id:r.contact_id,audit_report_id:r.id,audit_id:r.audit_id,is_sample:isSampleCase(r),name:(isSampleCase(r)?'Sample — ':'')+(r.kind==='pre'?'Pre-meeting audit':'Full audit and proposed services')+' · version '+(r.revision+1),kind:'Audit',size:'HTML / PDF',at:r.created_at,url:'/api/audits/reports/'+encodeURIComponent(r.id)}))];
}
async function ensureSampleAudit(env,user){
 // Append only the reserved fictional record. CAS retries always re-read the
 // complete snapshot, so a concurrent real contact edit cannot be overwritten.
 let updatedAt=null,ready=false;
 for(let attempt=0;attempt<3;attempt++){
  const previous=await stmt(env,'SELECT data,updated_at FROM crm_snapshot WHERE org_id=?',user.orgId).first();
  if(!previous)throw error('Open the CRM workspace before creating a sample audit.',409);
  const data=await decodeSnapshot(previous.data),existing=(data.contacts||[]).find(c=>c.id===SAMPLE_CONTACT_ID);
  if(existing&&!(existing.is_sample===true&&existing.sample_kind==='audit_fixture'))throw error('The reserved sample contact ID is already used. Ask the owner to review it.',409);
  if(existing&&!existing.deleted_at){updatedAt=previous.updated_at??null;ready=true;break;}
  if(!Array.isArray(data.contacts))throw error('The workspace contact list is unavailable.',409);
  if(existing)Object.assign(existing,{deleted_at:null});else data.contacts.push(sampleContact(user,now()));
  updatedAt=await writeSnapshot(env,user.orgId,JSON.stringify(data),user.id,previous);
  if(updatedAt){ready=true;break;}
 }
 if(!ready)throw error('The workspace changed while creating the sample. Reload and try again.',409);
 const stamp=now(),id=crypto.randomUUID();
 const inserted=await stmt(env,"INSERT INTO audit_cases (id,org_id,contact_id,deal_id,status,evidence_json,created_at,updated_at,by_user_id) VALUES (?,?,?,?,'collecting',?,?,?,?) ON CONFLICT(org_id,deal_id) DO NOTHING",id,user.orgId,SAMPLE_CONTACT_ID,SAMPLE_DEAL_ID,JSON.stringify(sampleEvidence(stamp)),stamp,stamp,user.id).run();
 let row=await stmt(env,'SELECT * FROM audit_cases WHERE org_id=? AND deal_id=?',user.orgId,SAMPLE_DEAL_ID).first();
 if(row.contact_id!==SAMPLE_CONTACT_ID)throw error('The reserved sample case is already used. Ask the owner to review it.',409);
 const pre=await stmt(env,"SELECT id FROM audit_reports WHERE org_id=? AND audit_id=? AND kind='pre' LIMIT 1",user.orgId,row.id).first();
 if(!pre){await saveReport(env,row,'pre',contactFor(await snapshot(env,user.orgId),SAMPLE_CONTACT_ID));await stmt(env,"UPDATE audit_cases SET status='pre_ready',updated_at=? WHERE org_id=? AND id=? AND status='collecting' AND revision=?",now(),user.orgId,row.id,row.revision).run();row=await caseFor(env,user.orgId,row.id);}
 return {id:row.id,status:row.status,sample:true,contactId:SAMPLE_CONTACT_ID,reused:!inserted.meta?.changes,updatedAt};
}
export async function queueAudit(env,user,deal,contact){
 const stamp=now(),id=crypto.randomUUID();await stmt(env,"INSERT INTO audit_cases (id,org_id,contact_id,deal_id,status,created_at,updated_at,by_user_id) VALUES (?,?,?,?,'queued',?,?,?) ON CONFLICT(org_id,deal_id) DO NOTHING",id,user.orgId,contact.id,deal.id,stamp,stamp,user.id).run();
 return await stmt(env,'SELECT * FROM audit_cases WHERE org_id=? AND deal_id=?',user.orgId,deal.id).first();
}
export async function generateQueuedAudit(env,user,id){
 let row=await caseFor(env,user.orgId,id);if(row.status!=='queued')return;
 const claim=await stmt(env,"UPDATE audit_cases SET status='researching',updated_at=? WHERE org_id=? AND id=? AND status='queued'",now(),user.orgId,id).run();if(!claim.meta?.changes)return;
 try{
  const db=await snapshot(env,user.orgId),c=contactFor(db,row.contact_id);
  const target=targetInput({name:c.name,city:[c.city,c.state].filter(Boolean).join(', '),brokerage:c.brokerage,email:c.email,phone:c.phone});
  const evidence=isSampleContact(c)?sampleEvidence(now()):[...JSON.parse(row.evidence_json),await connector(env,user,'discovery',target,'audit-auto-'+id,true)];
  await stmt(env,"UPDATE audit_cases SET evidence_json=?,updated_at=? WHERE org_id=? AND id=? AND status='researching'",JSON.stringify(evidence),now(),user.orgId,id).run();
  row=await caseFor(env,user.orgId,id);await saveReport(env,row,'pre',c);await stmt(env,"UPDATE audit_cases SET status='pre_ready',updated_at=? WHERE org_id=? AND id=? AND status='researching'",now(),user.orgId,id).run();
 }catch(e){await stmt(env,"UPDATE audit_cases SET status='needs_attention',updated_at=? WHERE org_id=? AND id=? AND status IN ('researching','pre_ready')",now(),user.orgId,id).run();throw e;}
}
export async function enqueueDemoAudits(env,user,before,after,ctx){
 if(!canEditSalesPipeline(user))return;for(const deal of newDemoDeals(before,after)){if(!user.isOwner&&!canAccessSalesDeal(deal,after,user))continue;const c=contactFor(after,deal.contact_id);if(isSampleContact(c))continue;const row=await queueAudit(env,user,deal,c),serviceUser=user.isOwner?user:{id:'system:sales-demo-audit',orgId:user.orgId,isOwner:true};if(row.status==='queued')ctx.waitUntil(generateQueuedAudit(env,serviceUser,row.id).catch(e=>console.error('Pre-meeting audit failed',e.message)));}
}
export async function resumeAuditQueue(env){
 await stmt(env,"UPDATE audit_cases SET status='needs_attention' WHERE status='collecting' AND updated_at < ?",new Date(Date.now()-10*60000).toISOString()).run();
 await stmt(env,"UPDATE audit_cases SET status='meeting_saved' WHERE status='generating' AND updated_at < ?",new Date(Date.now()-10*60000).toISOString()).run();
 // No extra cron: reuse the existing 15-minute Worker tick. A timed-out claim
 // is recovered; its idempotent connector run never spends credits twice.
 await stmt(env,"UPDATE audit_cases SET status='queued' WHERE status='researching' AND updated_at < ?",new Date(Date.now()-10*60000).toISOString()).run();
 const rows=(await env.DB.prepare("SELECT * FROM audit_cases WHERE status='queued' ORDER BY created_at LIMIT 5").all()).results||[];
 for(const row of rows){await generateQueuedAudit(env,{isOwner:true,orgId:row.org_id,id:row.by_user_id},row.id).catch(e=>console.error('Audit queue failed',e.message));}
}
export async function handleAudits(request,env,user,ctx){
 if(!user.isOwner)return json({error:'Owner/Admin access required.'},403);
 const parts=new URL(request.url).pathname.replace('/api/audits','').split('/').filter(Boolean);
 try{
  if(parts[0]==='reports'&&request.method==='GET'){
   const record=await stmt(env,'SELECT * FROM audit_reports WHERE org_id=? AND id=?',user.orgId,parts[1]).first();if(!record)throw error('Report not found.',404);
   contactFor(await snapshot(env,user.orgId),record.contact_id);
   return new Response(reportHtml(JSON.parse(record.report_json)),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'",'x-content-type-options':'nosniff'}});
  }
  if(parts[0]==='sample'&&request.method==='POST'){await readInput(request);return json(await ensureSampleAudit(env,user));}
  const db=await snapshot(env,user.orgId);
  if(!parts.length&&request.method==='GET'){
   const rows=(await stmt(env,'SELECT * FROM audit_cases WHERE org_id=? ORDER BY created_at DESC LIMIT 200',user.orgId).all()).results||[];
   const reports=(await stmt(env,'SELECT id,audit_id,kind,revision,created_at FROM audit_reports WHERE org_id=? ORDER BY created_at DESC',user.orgId).all()).results||[];
   return json({cases:rows.filter(r=>(db.contacts||[]).some(c=>c.id===r.contact_id&&!c.deleted_at)).map(r=>({...unpack(r),contact:contactFor(db,r.contact_id),reports:reports.filter(p=>p.audit_id===r.id)})),contacts:(db.contacts||[]).filter(c=>!c.deleted_at).map(c=>({id:c.id,name:c.name})),questions:QUESTIONS,services:SERVICES});
  }
  if(parts[0]==='start'&&request.method==='POST'){
   const input=await readInput(request),c=contactFor(db,input.contactId);if(c.id===SAMPLE_CONTACT_ID)return json(await ensureSampleAudit(env,user));if(isSampleContact(c))throw error('Use the fictional sample audit workflow for sample contacts.',409);const deal=(db.deals||[]).find(d=>d.contact_id===c.id&&!d.deleted_at&&(!input.dealId||d.id===input.dealId));
   if(!deal)throw error('Open a deal for this contact first.',409);
   const row=await queueAudit(env,user,deal,c);if(row.status==='queued')ctx.waitUntil(generateQueuedAudit(env,user,row.id).catch(e=>console.error('Audit generation failed',e.message)));return json({id:row.id,status:row.status});
  }
  let row=await caseFor(env,user.orgId,parts[0]);const c=contactFor(db,row.contact_id);
  if(request.method==='GET')return json({audit:unpack(row),contact:c,questions:QUESTIONS,services:SERVICES,...(isSampleCase(row)?{sample:true,sampleAnswers:SAMPLE_ANSWERS,sampleServices:SAMPLE_SERVICES,sampleServiceNotes:SAMPLE_SERVICE_NOTES}:{})});
  const input=await readInput(request);expectRevision(row,input);
  if(parts[1]==='answers'&&request.method==='PUT'){
   let answers;try{answers=validateAnswers(input.answers);}catch(e){throw error(e.message);}
   if(!Array.isArray(input.services||[]))throw error('Choose valid services.');
   const services=[...new Set(input.services||[])];if(services.some(s=>!SERVICES.some(x=>x.id===s)))throw error('Unknown service.');const notes=String(input.serviceNotes||'').trim();if(notes.length>4000)throw error('Service scope notes are too long.');
   const changed=await stmt(env,"UPDATE audit_cases SET answers_json=?,services_json=?,service_notes=?,revision=revision+1,status='meeting_saved',updated_at=? WHERE org_id=? AND id=? AND revision=? AND status NOT IN ('queued','researching','collecting','generating')",JSON.stringify(answers),JSON.stringify(services),notes,now(),user.orgId,row.id,row.revision).run();if(!changed.meta?.changes)throw error('Audit is busy or was updated. Reload before saving.',409);return json({audit:unpack(await caseFor(env,user.orgId,row.id))});
  }
  if(parts[1]==='generate'&&request.method==='POST'){
   if(['queued','researching','collecting','generating'].includes(row.status))throw error('Wait for the current audit operation to finish.',409);
   const answers=JSON.parse(row.answers_json);
   if(QUESTIONS.some(q=>q.required&&!answers[q.id]))throw error('Complete every meeting question. Use Unknown when a process was not assessed.');
   const previousStatus=row.status;
   const claimed=await stmt(env,"UPDATE audit_cases SET status='generating',updated_at=? WHERE org_id=? AND id=? AND revision=? AND status NOT IN ('queued','researching','collecting','generating')",now(),user.orgId,row.id,row.revision).run();
   if(!claimed.meta?.changes)throw error('Audit is busy or was updated. Reload before generating.',409);
   try{await saveReport(env,row,'full',c);await stmt(env,"UPDATE audit_cases SET status='full_ready',updated_at=? WHERE org_id=? AND id=? AND revision=? AND status='generating'",now(),user.orgId,row.id,row.revision).run();return json({audit:unpack(await caseFor(env,user.orgId,row.id))});}
   catch(e){await stmt(env,"UPDATE audit_cases SET status=?,updated_at=? WHERE org_id=? AND id=? AND revision=? AND status='generating'",previousStatus,now(),user.orgId,row.id,row.revision).run();throw e;}
  }
  if(parts[1]==='refresh-report'&&request.method==='POST'){
   if(['queued','researching','collecting','generating'].includes(row.status))throw error('Wait for the current audit operation to finish.',409);
   const changed=await stmt(env,"UPDATE audit_cases SET revision=revision+1,status='collecting',updated_at=? WHERE org_id=? AND id=? AND revision=? AND status NOT IN ('queued','researching','collecting','generating')",now(),user.orgId,row.id,row.revision).run();if(!changed.meta?.changes)throw error('Audit changed. Reload before generating.',409);
   try{row=await caseFor(env,user.orgId,row.id);await saveReport(env,row,'pre',c);await stmt(env,"UPDATE audit_cases SET status='pre_ready',updated_at=? WHERE org_id=? AND id=? AND revision=?",now(),user.orgId,row.id,row.revision).run();return json({audit:unpack(await caseFor(env,user.orgId,row.id))});}catch(e){await stmt(env,"UPDATE audit_cases SET status='needs_attention',updated_at=? WHERE org_id=? AND id=? AND status='collecting'",now(),user.orgId,row.id).run();throw e;}
  }
  if(parts[1]==='research'&&request.method==='POST'){
   if(isSampleContact(c))throw error('This fictional sample cannot run public research or spend provider credits. Start an audit for a real contact to collect evidence.',409);
   if(['queued','researching','collecting','generating'].includes(row.status))throw error('Wait for the current audit operation to finish.',409);
   const target=targetInput({...input.target,name:c.name,email:c.email,phone:c.phone});const selected=[...new Set(input.sources||[])];if(!selected.length||selected.some(s=>!SOURCES.includes(s)||['crm','discovery'].includes(s)))throw error('Select public evidence sources.');
   if(selected.some(s=>s!=='instagram')&&input.allowPaid!==true)throw error('Confirm provider credit use before collecting these sources.');
   if(!target.identityConfirmed)throw error('Confirm the profiles belong to this contact.');if(selected.some(s=>!target.links[s]))throw error('Each selected source needs a profile URL.');
   const claimed=await stmt(env,"UPDATE audit_cases SET status='collecting',updated_at=? WHERE org_id=? AND id=? AND revision=? AND status NOT IN ('queued','researching','collecting','generating')",now(),user.orgId,row.id,row.revision).run();if(!claimed.meta?.changes)throw error('Audit is busy or was updated.',409);
   try{const evidence=JSON.parse(row.evidence_json);for(const source of selected)evidence.push(await connector(env,user,source,target,'audit-'+row.id+'-'+row.revision+'-'+source,input.allowPaid===true));
    await stmt(env,"UPDATE audit_cases SET evidence_json=?,revision=revision+1,status='collecting',updated_at=? WHERE org_id=? AND id=? AND revision=?",JSON.stringify(evidence),now(),user.orgId,row.id,row.revision).run();row=await caseFor(env,user.orgId,row.id);await saveReport(env,row,'pre',c);await stmt(env,"UPDATE audit_cases SET status='pre_ready',updated_at=? WHERE org_id=? AND id=? AND revision=?",now(),user.orgId,row.id,row.revision).run();return json({audit:unpack(await caseFor(env,user.orgId,row.id))});
   }catch(e){await stmt(env,"UPDATE audit_cases SET status='needs_attention',updated_at=? WHERE org_id=? AND id=? AND status='collecting'",now(),user.orgId,row.id).run();throw e;}
  }
  if(parts[1]==='retry'&&request.method==='POST'&&row.status==='needs_attention'){
   await stmt(env,"UPDATE audit_cases SET status='queued',updated_at=? WHERE org_id=? AND id=? AND revision=?",now(),user.orgId,row.id,row.revision).run();ctx.waitUntil(generateQueuedAudit(env,user,row.id).catch(e=>console.error('Audit retry failed',e.message)));return json({id:row.id,status:'queued'});
  }
  throw error('Not found.',404);
 }catch(e){return json({error:e.status?e.message:e.message?.startsWith('Complete every')?e.message:'Audit storage or generation is unavailable. Check the audit migrations and provider configuration.'},e.status||503);}
}
