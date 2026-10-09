// Follow-up work is derived from saved templates and schedules, never accepted
// as arbitrary records in a contributor's whole-workspace autosave.
const parts=(date,tz)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
const wallMs=p=>Date.UTC(p.year,p.month-1,p.day,p.hour||0,p.minute||0,p.second||0);
function localToUtc(p,tz){const wall=wallMs(p);let value=wall;for(let i=0;i<3;i++){const offset=wallMs(parts(new Date(value),tz))-value;value=wall-offset;}return new Date(value).toISOString();}
const dateKey=(iso,tz)=>{const p=parts(new Date(iso),tz);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;};
export function nextRecurringAt(iso,rec,tz){
 if(!Number.isFinite(Date.parse(iso)))return null;
 const p=parts(new Date(iso),tz),base=new Date(wallMs({...p,second:0})),n=Number(rec.interval)||1;
 if(n<1||n>3650)return null;
 if(rec.repeat==='Daily'||rec.unit==='Days')base.setUTCDate(base.getUTCDate()+n);
 else if(rec.repeat==='Monthly'||rec.unit==='Months')base.setUTCMonth(base.getUTCMonth()+n);
 else base.setUTCDate(base.getUTCDate()+7*n);
 return localToUtc({year:base.getUTCFullYear(),month:base.getUTCMonth()+1,day:base.getUTCDate(),hour:base.getUTCHours(),minute:base.getUTCMinutes()},tz);
}
const applies=(inst,step)=>!step.condition||!!inst.flags?.[step.condition];
function taskId(before,incoming,match){
 const existing=new Set((before.todos||[]).map(t=>t.id));
 const candidate=(incoming.todos||[]).find(t=>!existing.has(t.id)&&match(t)&&/^[A-Za-z0-9_-]{1,100}$/.test(t.id));
 return candidate?.id||'w_'+crypto.randomUUID();
}
function contactZone(db,id){return (db.contacts||[]).find(c=>c.id===id)?.timezone||'America/New_York';}
function assignedToUser(task,db,user){const norm=v=>String(v||'').trim().toLowerCase(),ids=new Set([user.id,user.name,user.email,...(db.users||[]).filter(u=>norm(u.email)===norm(user.email)).map(u=>u.id)].map(norm));return [task.assignee,task.assignee_user_id,task.assigned_to,...(task.assignees||[]),...(task.assigned_user_ids||[])].some(v=>ids.has(norm(typeof v==='object'?v?.user_id||v?.id:v))&&!!norm(typeof v==='object'?v?.user_id||v?.id:v));}
function approvalTask(db,task){if(task.social_post_id&&/^Approve /i.test(task.title||''))return true;const inst=(db.sop_instances||[]).find(i=>i.id===task.sop_instance_id),tpl=inst?.template_snapshot||(db.sop_templates||[]).find(t=>t.id===inst?.template_id);return !!(tpl?.steps||[]).find(s=>s.id===task.sop_step_id&&s.approval);}
function readySopTasks(db,before,incoming,inst,user,at,ids){
 const tpl=inst.template_snapshot||(db.sop_templates||[]).find(t=>t.id===inst.template_id);if(!tpl||inst.status!=='Active')return;
 const steps=tpl.steps||[];
 for(const st of steps){
  if(!applies(inst,st)){if(!inst.completed?.[st.id]&&!inst.skipped?.[st.id])(inst.skipped||={})[st.id]={at,by:'System',reason:'Condition did not apply',automatic:true};continue;}
  if(inst.completed?.[st.id]||inst.skipped?.[st.id])continue;
  const raw=st.depends_on||st.depends||[],deps=Array.isArray(raw)?raw:[raw];
  if(!deps.every(id=>inst.completed?.[id]||inst.skipped?.[id]))continue;
  if(!(db.todos||[]).some(t=>t.sop_instance_id===inst.id&&t.sop_step_id===st.id&&t.status!=='Cancelled')){
   const tz=inst.timezone||contactZone(db,inst.contact_id),p=parts(new Date(at),tz),due=new Date(Date.UTC(p.year,p.month-1,p.day+(Number(st.due_days)||0),st.due_hour??17));
   const id=taskId(before,incoming,t=>t.sop_instance_id===inst.id&&t.sop_step_id===st.id);
   const owner=(db.users||[]).find(u=>u.auth_user_id==='u_ibrar'||u.id==='u_ibrar'||u.role==='Owner / Admin');
   (db.todos||=[]).push({id,org_id:user.orgId,contact_id:inst.contact_id,title:st.title,module:st.module||tpl.service||'01',source:'SOP',status:'Open',assignee:st.approval?(owner?.name||'Ibrar Ul Islam'):(inst.assignee||user.name),due_at:localToUtc({year:due.getUTCFullYear(),month:due.getUTCMonth()+1,day:due.getUTCDate(),hour:due.getUTCHours()},tz),due_tz:tz,minutes:0,time_logs:[],runs_outside_plan:!!st.outside,op_status:st.approval?'Needs Review':'Not Started',sop_instance_id:inst.id,sop_step_id:st.id,sop_phase:st.phase||'',evidence_required:!!st.evidence_required,task_type_id:st.task_type_id||null,task_type_snapshot:(db.task_types||[]).find(x=>x.id===st.task_type_id)?.name||st.title});ids.add(id);
  }
  if(!st.parallel)break;
 }
 const applicable=steps.filter(st=>applies(inst,st));if(applicable.length&&applicable.every(st=>inst.completed?.[st.id]||inst.skipped?.[st.id])){inst.status='Complete';inst.completed_at=at;}
}
export function startDerivedSop(db,templateId,contactId,user,at){
 if((db.sop_instances||[]).some(inst=>inst.template_id===templateId&&inst.contact_id===contactId&&inst.status!=='Cancelled'&&!inst.deleted_at))return;
 const template=(db.sop_templates||[]).find(t=>t.id===templateId);if(!template)return;
 const owner=(db.users||[]).find(u=>u.auth_user_id==='u_ibrar'||u.id==='u_ibrar'||u.role==='Owner / Admin'),contact=(db.contacts||[]).find(c=>c.id===contactId);
 const inst={id:'si_'+crypto.randomUUID(),org_id:user.orgId,template_id:templateId,template_version:template.version||1,template_snapshot:structuredClone(template),contact_id:contactId,assignee:owner?.name||'Ibrar Ul Islam',timezone:contact?.timezone||'Asia/Karachi',status:'Active',flags:{},completed:{},skipped:{},history:[{at,by:user.name,action:'Started from sales stage'}],started_at:at};
 (db.sop_instances||=[]).push(inst);readySopTasks(db,{todos:[]},{todos:[]},inst,user,at,new Set());
}
export function deriveWorkTransitions(db,before,incoming,user,allowed,allowedTickets=new Set()){
 const created=new Set(),at=new Date().toISOString();
 for(const ticket of db.tickets||[]){
  const old=(before.tickets||[]).find(t=>t.id===ticket.id);if(!old||!allowedTickets.has(old.id)||old.status===ticket.status)continue;
  ticket.status_at=at;ticket.closed_at=ticket.status==='Query done'?at:null;
  const linked=(db.todos||[]).filter(t=>t.ticket_id===ticket.id&&t.status==='Open');
  if(ticket.status==='Assigned'&&!linked.length){
   const tz=contactZone(db,ticket.contact_id),p=parts(new Date(at),tz),id=taskId(before,incoming,t=>t.ticket_id===ticket.id);
   (db.todos||=[]).push({id,org_id:user.orgId,contact_id:ticket.contact_id,ticket_id:ticket.id,title:old.title,module:old.module,source:'Requested',status:'Open',assignee:old.assignee||user.name,due_at:localToUtc({...p,hour:17,minute:0,second:0},tz),due_tz:tz,minutes:0,time_logs:[],runs_outside_plan:old.type==='Problem',op_status:'Not Started'});created.add(id);
  }
  if(ticket.status==='In progress')for(const t of linked)if(assignedToUser(t,db,user))t.op_status='In Progress';
  if(ticket.status==='Waiting on client feedback'){
   for(const t of linked)if(assignedToUser(t,db,user))t.op_status='Waiting';
   if(!(db.reminders||[]).some(r=>r.ticket_id===ticket.id&&!r.done)){
    const tz=contactZone(db,ticket.contact_id),p=parts(new Date(at),tz),due=new Date(Date.UTC(p.year,p.month-1,p.day+3,9)),owner=(db.users||[]).find(u=>u.auth_user_id==='u_ibrar'||u.id==='u_ibrar'||u.role==='Owner / Admin');
    (db.reminders||=[]).push({id:'r_'+crypto.randomUUID(),org_id:user.orgId,contact_id:ticket.contact_id,ticket_id:ticket.id,kind:'Email',title:'Chase client feedback: '+old.title,at:localToUtc({year:due.getUTCFullYear(),month:due.getUTCMonth()+1,day:due.getUTCDate(),hour:9},tz),timezone:tz,assignee:owner?.name||'Ibrar Ul Islam',done:false});
   }
  }
  if(ticket.status==='Query done')for(const t of linked){
   if(!assignedToUser(t,db,user))throw Error('This ticket has open work assigned to another person. Ibrar must close or reassign it.');
   if(approvalTask(db,t))throw Error('Only Ibrar can close an approval task linked to this ticket.');
   if(t.evidence_required&&!String(t.completion_note||'').trim())throw Error('A linked SOP step requires evidence before this ticket can close.');
   t.status='Done';t.op_status='Complete';t.completed_at||=at;
   for(const log of t.time_logs||[])if(!log.end_at){log.end_at=at;log.duration_ms=Math.max(0,Date.parse(at)-Date.parse(log.start_at));}
   t.minutes=Math.round((t.time_logs||[]).reduce((sum,l)=>sum+(Number(l.duration_ms)||0),0)/60000);
  }
 }
 for(const task of db.todos||[]){
  const old=(before.todos||[]).find(t=>t.id===task.id);
  if(!old||!allowed.has(old.id)||old.status==='Done'||task.status!=='Done')continue;
  if(old.evidence_required&&!String(task.completion_note||'').trim())throw Error('This SOP step requires evidence or a completion note before it can close.');
  task.completed_at=at;task.op_status='Complete';
  let stopped=false;for(const log of task.time_logs||[])if(!log.end_at){log.end_at=at;log.duration_ms=Math.max(0,Date.parse(at)-Date.parse(log.start_at));stopped=true;}
  if(stopped)task.minutes=Math.round((task.time_logs||[]).reduce((sum,l)=>sum+(Number(l.duration_ms)||0),0)/60000);
  task.timer_started_at=null;task.timer=null;
  if(old.sop_instance_id&&old.sop_step_id){
   const inst=(db.sop_instances||[]).find(i=>i.id===old.sop_instance_id&&i.status==='Active');
   if(inst){const tpl=inst.template_snapshot||(db.sop_templates||[]).find(t=>t.id===inst.template_id);if((tpl?.steps||[]).some(s=>s.id===old.sop_step_id&&s.approval))throw Error('Only Ibrar can approve this SOP step.');(inst.completed||={})[old.sop_step_id]={at,by:user.name};if(inst.skipped)delete inst.skipped[old.sop_step_id];(inst.history||=[]).push({at,by:user.name,action:'Completed step',step_id:old.sop_step_id});readySopTasks(db,before,incoming,inst,user,at,created);}
  }
  if(old.social_post_id){
   const post=(db.social_posts||[]).find(p=>p.id===old.social_post_id);
   if(post&&/^Publish /i.test(old.title||'')){
    if(!user.visibility?.editSections.includes('social'))throw Error('Social publishing is read-only for your account.');
    if(post.approval_required&&!['Approved','Ready','Published'].includes(post.status))throw Error('This post requires approval before it can be marked published.');
    post.status='Published';post.published_at=at;
   }
   if(post&&/^Approve /i.test(old.title||''))throw Error('Only Ibrar can approve a social post.');
  }
  if(old.recurrence){
   const rec=structuredClone(old.recurrence),tz=old.due_tz||contactZone(db,old.contact_id),next=nextRecurringAt(old.due_at,rec,tz);if(!next)continue;
   rec.series_id||='rs_'+old.id;task.recurrence=rec;
   const completed=(db.todos||[]).filter(t=>t.status==='Done'&&t.recurrence?.series_id===rec.series_id).length;
   if(rec.endType==='End after occurrences'&&completed>=Number(rec.occurrences))continue;
   if(rec.endType==='End on date'&&rec.endDate&&dateKey(next,tz)>rec.endDate)continue;
   const key=rec.series_id+'|'+next;if((db.todos||[]).some(t=>t.recurrence_key===key))continue;
   const id=taskId(before,incoming,t=>t.due_at===next&&t.contact_id===old.contact_id&&t.title===old.title&&!!t.recurrence&&!t.sop_instance_id);
   db.todos.push({...structuredClone(old),id,recurrence:rec,recurrence_key:key,due_at:next,status:'Open',op_status:'Not Started',time_logs:[],minutes:0,completion_note:'',completed_at:null,due_notified_at:null,timer:null,timer_started_at:null,logged_ms:0,timer_ms:0});created.add(id);
  }
 }
 return created;
}
