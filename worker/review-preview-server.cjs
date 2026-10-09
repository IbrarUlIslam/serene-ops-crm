'use strict';
// Local-only visual and workflow fixture. Never calls providers or writes to disk.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const host = '127.0.0.1', port = 8789;
const clone = value => structuredClone(value);
const stamp = () => new Date().toISOString();
const hours = n => new Date(Date.now() + n * 3600000).toISOString();
const id = prefix => prefix + '_' + crypto.randomUUID();
const ownerName = 'Ibrar Ul Islam', staffName = 'Zayna Azem';

async function main() {
  const {QUESTIONS, SERVICES, validateAnswers, buildReport, reportHtml} = await import('./audit-report.mjs');
  const {SECTION_CHOICES, scopeSnapshot, mergeScopedWrite, allowedStaffRoute} = await import('./user-access.mjs');
  let revision = 1, updatedAt = stamp();
  const etag = () => '"' + updatedAt + '"';
  const sections = SECTION_CHOICES.map(section => section.id);
  const owner = {id:'u_ibrar',orgId:'org1',name:ownerName,email:'ibrar.qa@example.invalid',roleCode:'owner_admin',roleName:'Owner / Admin',isOwner:true,visibility:{sections,editSections:['work','tickets','social'],scope:'all'}};
  const staff = {id:'u_zayna',orgId:'org1',name:staffName,email:'zayna.qa@example.invalid',roleCode:'contributor',roleName:'Assigned contributor',isOwner:false,visibility:{sections:['today','calendar','clients','work','tickets','social','sops','meetings','activity'],editSections:['work','tickets','social'],scope:'assigned'}};
  const users = [
    {id:owner.id,name:owner.name,email:owner.email,status:'active',isOwner:true,sections,editSections:['work','tickets','social']},
    {id:staff.id,name:staff.name,email:staff.email,status:'active',isOwner:false,sections:staff.visibility.sections,editSections:staff.visibility.editSections,invitation_status:'access_ready'}
  ];
  const contact = (key, name, state, status, assignee) => ({id:key,org_id:'org1',name,brokerage:'Fictional QA Realty',city:state==='TX'?'Austin':'Tampa',state,timezone:state==='TX'?'America/Chicago':'America/New_York',status,email:key+'@example.invalid',phone:'',services:status==='Client'?['02','03','06']:[],lead_source:'Referral',transactions_per_year:'10 to 25',monthly_override:'',rate_locked_until:'',notice_days:30,week_one_target:'Test listing handoff and CRM next actions.',drive_folder_url:'',consent_given_at:stamp(),consent_source:'Fictional preview authorization',consent_withdrawn_at:null,work_start:9,work_end:17,call_start:9,call_end:18,owner:ownerName,owner_user_id:assignee,notes:'Fictional QA record. No real realtor or business was researched.',created_at:hours(-72),deleted_at:null,tags:['QA fixture'],onboarding:{nda:true,vault:true,access:true}});
  const template = {id:'qa_sop_listing',title:'Listing launch · QA example',service:'02',summary:'Fictional workflow for checking task, approval and evidence screens.',version:'1.0',kind:'Service',sources:[],steps:[{id:'intake',title:'Collect the approved listing information',dueDays:1,critical:true,approval:false,evidence:true,depends:[]},{id:'review',title:'Agent reviews the launch packet',dueDays:1,critical:true,approval:true,evidence:false,depends:['intake']},{id:'publish',title:'Check the public listing links',dueDays:1,critical:false,approval:false,evidence:true,depends:['review']}]};
  let db = {
    org:{id:'org1',name:'Serene Ops · Local QA',capacity_hours:230,trigger:.75},
    users:[{id:'u1',auth_user_id:owner.id,name:owner.name,email:owner.email,role:'Owner / Admin',status:'active'},{id:'u2',auth_user_id:staff.id,name:staff.name,email:staff.email,role:'Contributor',status:'active'}],
    contacts:[contact('qa_jordan','Jordan Ellis · QA example','TX','Client',staff.id),contact('qa_taylor','Taylor Morgan · QA example','FL','Booked',owner.id)],
    deals:[{id:'qa_deal_taylor',contact_id:'qa_taylor',stage:'Demo scheduled',meeting_at:hours(26),prep_due_at:hours(2),artifact_type:'Landing page',artifact_minutes:0,checks:{'Audit run':true},scope_agreed:'',no_show_count:0,next_action_at:hours(2),stage_at:hours(-5),created_at:hours(-24),tags:[]},{id:'qa_deal_jordan',contact_id:'qa_jordan',stage:'Post-meeting audit sent',meeting_at:hours(-24),artifact_type:'Listing video',artifact_minutes:20,checks:{'Audit run':true,'Blind sections marked':true},scope_agreed:'Listing management and CRM support. Fictional agreed scope.',stage_at:hours(-20),created_at:hours(-48),tags:[]}],
    todos:[
      {id:'qa_task_listing',contact_id:'qa_jordan',title:'Review listing launch checklist',module:'02',source:'Requested',status:'Open',op_status:'In Progress',assignee:staffName,assignee_user_id:staff.id,due_at:hours(3),due_tz:'America/Chicago',minutes:30,time_logs:[],tags:['Listing'],created_at:hours(-4),runs_outside_plan:false},
      {id:'qa_task_followup',contact_id:'qa_taylor',title:'Prepare pre-meeting questions',module:'03',source:'Requested',status:'Open',op_status:'Not Started',assignee:ownerName,assignee_user_id:owner.id,due_at:hours(5),due_tz:'America/New_York',minutes:45,time_logs:[],tags:[],created_at:hours(-4),runs_outside_plan:false},
      {id:'qa_task_done',contact_id:'qa_jordan',title:'Confirm website inquiry routing',module:'03',source:'Requested',status:'Done',op_status:'Complete',assignee:staffName,assignee_user_id:staff.id,due_at:hours(-24),completed_at:hours(-22),minutes:20,time_logs:[{id:'qa_log',start:hours(-23),end:hours(-22.67),ms:1200000}],tags:[],created_at:hours(-48),runs_outside_plan:false}
    ],
    tickets:[{id:'qa_ticket_jordan',contact_id:'qa_jordan',title:'Listing photo approval',type:'Inquiry',status:'Assigned',module:'02',channel:'Email',owner:ownerName,owner_user_id:owner.id,assignee:staffName,assignee_user_id:staff.id,raised_at:hours(-3),status_at:hours(-2),minutes:15,body:'Fictional client requests a review before publishing. No actual message was sent.',tags:[]},{id:'qa_ticket_owner',contact_id:'qa_taylor',title:'Confirm meeting agenda',type:'Problem',status:'In progress',module:'03',channel:'Phone',owner:ownerName,assignee:ownerName,assignee_user_id:owner.id,raised_at:hours(-6),status_at:hours(-4),body:'Preview issue for owner-only filtering.',tags:[]}],
    social_posts:[{id:'qa_social_jordan',contact_id:'qa_jordan',account_id:'qa_instagram',platform:'Instagram',format:'Carousel',preset:'Client prime time',objective:'Listing awareness',title:'New listing overview · QA',caption:'Fictional approved caption for local preview.',audience_tz:'America/Chicago',scheduled_at:hours(8),assignee:staffName,assignee_user_id:staff.id,approval_required:true,status:'Approved',tags:[]},{id:'qa_social_owner',contact_id:'qa_taylor',platform:'Facebook',format:'Image',preset:'Client prime time',objective:'Trust',title:'Buyer guide · QA',caption:'Fictional draft.',audience_tz:'America/New_York',scheduled_at:hours(28),assignee:ownerName,assignee_user_id:owner.id,approval_required:true,status:'Draft',tags:[]}],
    meetings:[{id:'qa_meeting_taylor',contact_id:'qa_taylor',kind:'Demo',at:hours(26),source:'CRM',notes:'Fictional upcoming appointment.',assignee:ownerName,host_user_id:owner.id,timezone:'America/New_York',duration:30,match_state:'matched',summary_status:'pending'},{id:'qa_meeting_jordan',contact_id:'qa_jordan',kind:'Weekly call',at:hours(-24),source:'CRM',notes:'Fictional seller update discussion.',assignee:staffName,host_user_id:staff.id,timezone:'America/Chicago',duration:30,match_state:'matched',summary_status:'completed',summary_text:'Fictional summary: review launch approvals and database follow-up.',summary_next_steps:['Check approved listing copy','Review CRM next actions']}],
    business:[{id:'qa_setup',title:'Review service capacity',note:'Internal QA example',status:'Open',due_at:hours(24),assignee:ownerName}],
    access:[{id:'qa_access',contact_id:'qa_jordan',service:'03',system:'CRM',label:'Example access record',url:'',username:'qa-only',owner:ownerName,status:'Authorized',notes:'No password or real access details are present.'}],
    files:[{id:'qa_file',contact_id:'qa_jordan',name:'Listing launch checklist · example',kind:'Document',size:'QA example',at:hours(-12),url:'/qa-document.html'}],
    activity:[{id:'qa_activity1',at:hours(-1),who:staffName,what:'Task set to In Progress',contact_id:'qa_jordan',kind:'work',target:{recordId:'qa_task_listing',section:'work'},read:false},{id:'qa_activity2',at:hours(-2),who:ownerName,what:'Meeting booked',contact_id:'qa_taylor',kind:'meeting',target:{meetOpen:'qa_meeting_taylor'},read:false}],
    notes:[{id:'qa_note',entity_type:'contact',entity_id:'qa_jordan',body:'Fictional example: agent retains approvals; operations team maintains the agreed checklist.',by:ownerName,at:hours(-12)}],
    reminders:[{id:'qa_reminder',contact_id:'qa_jordan',kind:'Follow-up',title:'Check listing approval',at:hours(3),done:false,assignee:staffName,assignee_user_id:staff.id,timezone:'America/Chicago'}],
    plans:[],calls:[{id:'qa_call',contact_id:'qa_taylor',at:hours(-2),outcome:'Booked demo',note:'Fictional call record.',by:ownerName,by_user_id:owner.id,queue:'Manual'}],
    automations:[],autolog:[],sop_templates:[template],sop_sources:[],sop_instances:[{id:'qa_sop_instance',template_id:template.id,template_version:template.version,template_snapshot:clone(template),contact_id:'qa_jordan',assignee:staffName,assignee_user_id:staff.id,flags:{},status:'Active',started_at:hours(-4),completed:{},skipped:{},history:[]}],
    scope_usage:[{id:'qa_usage',contact_id:'qa_jordan',module:'02',period:new Date().toISOString().slice(0,7),used:1,limit:2,unit:'listings'}],social_accounts:[{id:'qa_instagram',contact_id:'qa_jordan',platform:'Instagram',username:'fictional.qa',audience_tz:'America/Chicago'}],
    federal_kb:[],state_kb:[],checklists:{precall:['Audit run','Blind sections marked','Artifact chosen','Artifact built','Description attached','Email sent','Answer logged'],onboarding:['NDA signed','Password manager vault created','Access log started']},user_prefs:{u1:{calTZ:'Asia/Karachi'},u2:{calTZ:'Asia/Karachi'}},mail_map:{},task_types:[],archive_items:[],price_history:[],emails:[],notifications:[]
  };
  const answers = Object.fromEntries(QUESTIONS.map(question => [question.id,question.type==='select'?'Unknown':'Fictional QA answer. Actual process was not assessed.']));
  const publicEvidence = [{source:'website',status:'not_assessed',note:'Fictional local preview. No public agent data was collected.',evidence:[]}];
  const cases = [
    {id:'qa_audit_taylor',contact_id:'qa_taylor',deal_id:'qa_deal_taylor',status:'pre_ready',revision:0,answers:{},services:[],service_notes:'',evidence:clone(publicEvidence),created_at:hours(-2),reports:[]},
    {id:'qa_audit_jordan',contact_id:'qa_jordan',deal_id:'qa_deal_jordan',status:'full_ready',revision:1,answers,services:['02','03'],service_notes:'Fictional proposed listing checklists and CRM next actions. Agent retains all approvals.',evidence:clone(publicEvidence),created_at:hours(-24),reports:[]}
  ];
  const reports = new Map();
  function saveReport(row, kind) {
    const existing = row.reports.find(report => report.kind===kind && report.revision===row.revision);
    if (existing) return existing;
    const person = db.contacts.find(item => item.id===row.contact_id);
    const report = buildReport(kind,person,row.evidence,row.answers,row.services,row.service_notes,stamp());
    report.method = 'Fictional local QA preview. No provider, model, or real realtor was used.';
    const entry = {id:id('qa_report'),kind,revision:row.revision,created_at:stamp()};
    reports.set(entry.id,report); row.reports.unshift(entry); return entry;
  }
  for (const row of cases) { saveReport(row,'pre'); if (row.status==='full_ready') saveReport(row,'full'); }
  function documents() { return cases.flatMap(row => row.reports.map(report => ({id:'audit-report:'+report.id,audit_report_id:report.id,audit_id:row.id,contact_id:row.contact_id,name:(report.kind==='pre'?'Pre-meeting audit':'Full audit and proposed services')+' · version '+(report.revision+1),kind:'Audit',size:'HTML / PDF',at:report.created_at,url:'/api/audits/reports/'+report.id}))); }
  function snapshot(actor) { return scopeSnapshot({...db,files:[...db.files.filter(file=>!file.audit_report_id),...documents()]},actor); }
  function touch() { revision++; updatedAt=stamp(); }
  function ensureCases(before, after) {
    for (const deal of after.deals||[]) {
      if (deal.stage!=='Demo scheduled' || cases.some(row=>row.deal_id===deal.id)) continue;
      const prior=(before.deals||[]).find(item=>item.id===deal.id); if (prior?.stage==='Demo scheduled') continue;
      const row={id:id('qa_audit'),contact_id:deal.contact_id,deal_id:deal.id,status:'pre_ready',revision:0,answers:{},services:[],service_notes:'',evidence:clone(publicEvidence),created_at:stamp(),reports:[]}; cases.push(row);saveReport(row,'pre');
    }
  }
  const connectors = ['discovery','instagram','facebook','website','brokerage','zillow','realtor','listing','crm'].map(source=>({source,ready:true,name:'Local QA fixture',paid:false,secrets:[],coverage:'Fictional preview only. No provider requests are made.'}));
  const runs=[];
  const messages=[{messageId:'qa_mail1',folderId:'qa_inbox',subject:'Listing packet approval · QA example',fromAddress:'qa_jordan@example.invalid',toAddress:owner.email,receivedTime:Date.now()-7200000,status:'0',hasAttachment:false},{messageId:'qa_mail2',folderId:'qa_inbox',subject:'Meeting agenda · QA example',fromAddress:'qa_taylor@example.invalid',toAddress:owner.email,receivedTime:Date.now()-14400000,status:'1',hasAttachment:false}];
  const mailMeta={};
  const send=(res,value,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','ETag':etag(),...headers});res.end(JSON.stringify(value));};
  const html=(res,text,status=200)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"connect-src 'self'; form-action 'self'; base-uri 'self'; frame-src 'self' blob:;"});res.end(text);};
  async function body(req) { let text='';for await(const chunk of req){text+=chunk;if(text.length>8388608)throw Error('Preview request is too large.');}return text?JSON.parse(text):{}; }
  function actorFor(req,url) { const chosen=url.searchParams.get('qa');const role=chosen||(/(?:^|;\s*)sereneQaRole=staff(?:;|$)/.test(req.headers.cookie||'')?'staff':'owner');return role==='staff'?staff:owner; }
  function serveIndex(res,role) {
    let source=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const pattern=/<script type="__bundler\/template">\s*([\s\S]*?)\n<\/script>/;
    const match=source.match(pattern);if(!match)throw Error('The preview could not locate the frontend template.');
    let template=JSON.parse(match[1]);
    template=template.replace(/API_BASE\s*=\s*[^\n]+;/,"API_BASE = '';");
    template=template.replace('zoomEnsureEmbed(){','zoomEnsureEmbed(){ return;');
    template=template.replace('zohoConnect(){',"zohoConnect(){ this.toast('Local preview: account connections are disabled.'); return;");
    source=source.replace(pattern,()=>'<script type="__bundler/template">\n'+JSON.stringify(template).replace(/<\/script/gi,'<\\/script')+'\n</script>');
    res.setHeader('Set-Cookie','sereneQaRole='+role+'; Path=/; SameSite=Strict');
    html(res,source);
  }
  const server=http.createServer(async(req,res)=>{
    try {
      if(!/^(?:127\.0\.0\.1|localhost):8789$/.test(req.headers.host||''))return send(res,{error:'Loopback preview only.'},403);
      if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&!['http://127.0.0.1:8789','http://localhost:8789'].includes(req.headers.origin))return send(res,{error:'Preview origin is not allowed.'},403);
      const url=new URL(req.url,'http://127.0.0.1:8789'),p=url.pathname,actor=actorFor(req,url);
      if(req.method==='OPTIONS')return send(res,{},204);
      if(p==='/api/me')return send(res,actor);
      if(p==='/api/auth/status')return send(res,{authenticated:true,user:actor});
      if(p==='/api/db'&&req.method==='GET')return send(res,{data:snapshot(actor),updatedAt,updatedBy:owner.id});
      if(p==='/api/db'&&req.method==='PUT'){
        if(!req.headers['if-match'])return send(res,{error:'Reload before saving. A workspace revision is required.'},428);
        if(req.headers['if-match']!==etag())return send(res,{error:'This workspace changed. Reload before saving.',updatedAt},409);
        const input=await body(req),before=clone(db);input.files=(input.files||[]).filter(file=>!file.audit_report_id);db=mergeScopedWrite(db,input,actor);ensureCases(before,db);touch();return send(res,{data:{ok:true,updatedAt},snapshot:snapshot(actor)});
      }
      if(!actor.isOwner&&p.startsWith('/api/')&&!allowedStaffRoute(p))return send(res,{error:'This section is not available to your account.'},403);
      if(p==='/api/users'&&req.method==='GET')return send(res,{users,sections:SECTION_CHOICES,invitationReady:true,loginUrl:'http://127.0.0.1:8789/'});
      if(p==='/api/users'&&req.method==='POST'){
        const input=await body(req);if(!input.name?.trim()||!input.email?.includes('@'))return send(res,{error:'Enter a name and valid email.'},400);if(users.some(user=>user.email.toLowerCase()===input.email.toLowerCase()))return send(res,{error:'That email already has a preview account.'},409);
        const user={id:id('qa_user'),name:input.name.trim(),email:input.email.trim().toLowerCase(),status:'active',isOwner:false,sections:input.sections||[],editSections:input.editSections||[],invitation_status:input.invite?'access_ready':null};users.push(user);db.users.push({...user,role:'Contributor'});touch();return send(res,{ok:true,id:user.id,accessNotice:'Local preview: user and visibility saved in memory. No sign-in change or email was sent.'});
      }
      if(/^\/api\/users\/[^/]+\/invite$/.test(p)&&req.method==='POST'){
        const user=users.find(item=>item.id===p.split('/')[3]);if(!user||user.isOwner||user.status!=='active')return send(res,{error:'Only active preview contributors can be invited.'},400);user.invitation_status='access_ready';return send(res,{ok:true,id:user.id,accessNotice:'Local preview: invitation prepared. No Cloudflare access was changed and no email was sent.'});
      }
      if(/^\/api\/users\/[^/]+$/.test(p)&&req.method==='PUT'){
        const user=users.find(item=>item.id===p.split('/')[3]);if(!user)return send(res,{error:'User not found.'},404);if(user.isOwner)return send(res,{error:'The administrator account is fixed.'},409);const input=await body(req);Object.assign(user,{status:input.status,sections:input.sections||[],editSections:input.editSections||[]});if(user.id===staff.id)staff.visibility={sections:user.sections,editSections:user.editSections,scope:'assigned'};return send(res,{ok:true,id:user.id,accessNotice:'Local preview: visibility saved in memory.'});
      }
      if(p==='/api/audits'&&req.method==='GET')return send(res,{cases:cases.filter(row=>db.contacts.some(person=>person.id===row.contact_id&&!person.deleted_at)).map(row=>({...row,contact:db.contacts.find(person=>person.id===row.contact_id)})),contacts:db.contacts.filter(person=>!person.deleted_at).map(person=>({id:person.id,name:person.name})),questions:QUESTIONS,services:SERVICES});
      if(p==='/api/audits/start'&&req.method==='POST'){
        const input=await body(req),deal=db.deals.find(item=>item.contact_id===input.contactId&&item.stage==='Demo scheduled');if(!deal)return send(res,{error:'This contact needs a Demo scheduled deal first.'},400);let row=cases.find(item=>item.deal_id===deal.id);if(!row){row={id:id('qa_audit'),contact_id:deal.contact_id,deal_id:deal.id,status:'pre_ready',revision:0,answers:{},services:[],service_notes:'',evidence:clone(publicEvidence),created_at:stamp(),reports:[]};cases.push(row);saveReport(row,'pre');}return send(res,{id:row.id,status:row.status});
      }
      if(p.startsWith('/api/audits/reports/')){const report=reports.get(p.split('/').at(-1));return report?html(res,reportHtml(report)):send(res,{error:'Preview report not found.'},404);}
      if(/^\/api\/audits\/[^/]+\/[^/]+$/.test(p)){
        const row=cases.find(item=>item.id===p.split('/')[3]),action=p.split('/')[4];if(!row)return send(res,{error:'Preview audit not found.'},404);const input=await body(req);if(input.revision!==row.revision)return send(res,{error:'This audit changed. Reload before saving.'},409);
        if(action==='answers'&&req.method==='PUT'){row.answers=validateAnswers(input.answers,false);row.services=input.services||[];row.service_notes=input.serviceNotes||'';row.revision++;row.status='meeting_saved';return send(res,{audit:row});}
        if(action==='generate'&&req.method==='POST'){saveReport(row,'full');row.status='full_ready';return send(res,{audit:row});}
        if(['research','refresh-report','retry'].includes(action)&&req.method==='POST'){row.revision++;saveReport(row,'pre');row.status='pre_ready';return send(res,{id:row.id,status:row.status,audit:row});}
      }
      if(p==='/api/audit-connectors/status')return send(res,{connectors,dailyLimit:10});
      if(p==='/api/audit-connectors/runs')return send(res,{runs});
      if(p==='/api/audit-connectors/collect')return send(res,{error:'Local preview: external research is disabled.'},409);
      if(p==='/api/audit-connectors/manual'&&req.method==='POST'){const input=await body(req);const run={id:id('qa_run'),source:input.source,target:input.target,status:'manual',created_at:stamp(),result:{note:'Fictional dated evidence saved only in this local preview.',evidence:[{url:input.url||'',text:input.text,observedAt:input.observedAt}]}};runs.unshift(run);return send(res,{id:run.id,status:run.status});}
      if(p==='/api/zoom/phone-mapping')return send(res,{data:null});
      if(p==='/api/zoom/calls')return send(res,{data:{calls:[],voicemails:[]}});
      if(p==='/api/zoho/status')return send(res,{data:{connected:true,email:owner.email,accountId:'qa_mailbox',preview:true}});
      if(p==='/api/zoho/mail/folders')return send(res,{data:[{folderId:'qa_inbox',folderName:'Inbox',folderType:'Inbox'},{folderId:'qa_sent',folderName:'Sent',folderType:'Sent'},{folderId:'qa_drafts',folderName:'Drafts',folderType:'Drafts'}]});
      if(p==='/api/zoho/mail/messages')return send(res,{data:url.searchParams.get('folderId')==='qa_inbox'?messages:[]});
      if(p==='/api/zoho/mail/meta')return send(res,{data:mailMeta});
      if(p.startsWith('/api/zoho/mail/meta/')&&req.method==='PATCH'){const key=p.split('/').at(-1);mailMeta[key]={...(mailMeta[key]||{}),...await body(req)};return send(res,{data:mailMeta[key]});}
      if(p==='/api/zoho/mail/messages/mark-read'){const input=await body(req);for(const message of messages)if((input.messageIds||[]).includes(message.messageId))message.status='1';return send(res,{data:{ok:true}});}
      if(p==='/api/zoho/mail/send'||p.endsWith('/action'))return send(res,{error:'Local preview: email delivery is disabled.'},409);
      if(/^\/api\/zoho\/mail\/messages\/[^/]+\/[^/]+$/.test(p))return send(res,{data:{content:'<p>This is a fictional QA message. Please review the example listing packet before launch.</p>',subject:'Listing packet approval · QA example',fromAddress:'qa_jordan@example.invalid',attachments:[]}});
      if(p.startsWith('/api/'))return send(res,{error:'This provider action is unavailable in the local preview.'},404);
      if(p==='/qa-document.html')return html(res,'<!doctype html><html lang="en"><meta charset="utf-8"><title>QA document</title><body><h1>Fictional listing launch checklist</h1><p>This local document verifies contact attachment links. No real client data is present.</p></body></html>');
      if(p==='/'||p==='/index.html')return serveIndex(res,actor===staff?'staff':'owner');
      const relative=decodeURIComponent(p).replace(/^\//,''),file=path.resolve(root,relative),top=path.relative(root,file).split(path.sep)[0];
      if(!file.startsWith(root+path.sep)||top==='worker'||top.startsWith('.'))return send(res,{error:'Not found.'},404);
      const extension=path.extname(file).toLowerCase(),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
      if(!types[extension]||!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,{error:'Not found.'},404);
      res.writeHead(200,{'Content-Type':types[extension],'Cache-Control':'no-store','Content-Security-Policy':"connect-src 'self'; form-action 'self'; base-uri 'self'; frame-src 'self' blob:;"});res.end(fs.readFileSync(file));
    } catch(error) { send(res,{error:'Local preview: '+error.message},400); }
  });
  server.listen(port,host,()=>process.stdout.write('Fictional CRM review preview: http://127.0.0.1:8789/?qa=owner\nStaff view: http://127.0.0.1:8789/?qa=staff\nNo provider calls, emails, Cloudflare writes, or production data.\n'));
  server.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
