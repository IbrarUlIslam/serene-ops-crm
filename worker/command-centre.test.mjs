import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {scopeSnapshot} from './user-access.mjs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const template=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const plain=value=>JSON.parse(JSON.stringify(value));
const response=users=>({ok:true,json:async()=>({users})});
const roster=[{id:'u_ibrar',name:'Ibrar Ul Islam',email:'ibrar@example.test',status:'active',isOwner:true},{id:'u_zayna',name:'Zayna Azem',email:'zayna@example.test',status:'active'},{id:'u_new',name:'New Teammate',email:'new@example.test',status:'active'},{id:'u_zero',name:'Zero Work',email:'zero@example.test',status:'active'},{id:'u_disabled',name:'Disabled Person',email:'disabled@example.test',status:'disabled'}];

function fixture({staff=false,sections=['today','work'],contacts=false}={}){
  const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    location:{hostname:'crm.sereneop.com',origin:'https://crm.sereneop.com'},document:{querySelectorAll:()=>[]},
    window:{scrollTo(){},addEventListener(){},removeEventListener(){},location:{reload(){}}},
    DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
  vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);
  const c=new context.ReviewComponent();c.props={};c.toast=message=>{c.lastToast=message;};let saves=0;c.persistDb=()=>{saves++;};
  const user={id:staff?'u_zayna':'u_ibrar',orgId:'org1',name:staff?'Zayna Azem':'Ibrar Ul Islam',email:staff?'zayna@example.test':'ibrar@example.test',isOwner:!staff,visibility:{sections,editSections:['work']}};
  const task=(id,title,assignment,due_at='2026-10-07T14:00:00.000Z')=>({id,title,...assignment,due_at,due_tz:'Asia/Karachi',status:'Open',op_status:'Not Started',module:'03',source:'Requested',minutes:0,time_logs:[]});
  const full=c.ensureEnhancements({org:{id:'org1',name:'Serene Ops',capacity_hours:230,trigger:.75},users:[{id:'legacy_owner',auth_user_id:'u_ibrar',name:'Ibrar Ul Islam',email:'ibrar@example.test',role:'Owner / Admin'},{id:'legacy_staff',auth_user_id:'u_zayna',name:'Zayna Azem',email:'zayna@example.test',role:'Contributor'}],contacts:contacts?[{id:'c1',name:'Fictional CRM',status:'Client',services:[],state:'NY',timezone:'America/New_York',owner:'Zayna Azem'}]:[],deals:[],tickets:[],
    todos:[task('w_owner','Owner task',{assignee:'Ibrar Ul Islam'}),task('w_staff','Staff email task',{assignee:'  ZAYNA@EXAMPLE.TEST  '}),task('w_alias','Staff account ID task',{assignee_user_id:'u_zayna'},'2026-10-07T09:00:00.000Z'),task('w_new','New teammate task',{assigned_user_ids:['u_new']}),task('w_unassigned','Unassigned task',{})],checklists:{precall:[],onboarding:[]}});
  c.state={...c.state,authChecked:true,accessUser:user,dbLoadFailed:false,meIdUnresolved:false,meId:staff?'legacy_staff':'legacy_owner',db:c.normalizeScopedWorkspace(scopeSnapshot(full,user)),now:Date.parse('2026-10-07T12:00:00.000Z'),view:'today'};
  c._snapshotEtag='"preserve-etag"';c._saveEpoch=3;c._savedEpoch=2;
  return {c,user,full,saves:()=>saves};
}

test('Command centre renders with zero contacts and starts without fabricated team members',()=>{
  const {c}=fixture();const values=c.renderVals();assert.equal(c.state.db.contacts.length,0);assert.equal(values.vToday,true);assert.equal(values.commandTeamTitle,'Team');assert.equal(values.board.length,2);assert.equal(values.commandShowClock,false);assert.equal(values.commandShowUpcoming,false);assert.equal(values.commandUnassigned,'1 unassigned task');
});

test('owner refresh shows every active user, including new and zero-work users, with alias-aware counts',async()=>{
  const {c}=fixture();c.apiFetch=async path=>{assert.equal(path,'/api/users');return response(roster);};await c.refreshTeamRoster();const values=c.renderVals();assert.deepEqual(plain(values.board.map(person=>person.name)),['Ibrar Ul Islam','Zayna Azem','New Teammate','Zero Work']);assert.equal(values.commandTeamCount,'4 active users');
  const staff=values.board.find(person=>person.name==='Zayna Azem');assert.equal(staff.total,'2');assert.equal(staff.today,'2');assert.equal(staff.late,'1');assert.equal(values.board.find(person=>person.name==='New Teammate').total,'1');assert.equal(values.board.find(person=>person.name==='Zero Work').total,'0');
});

test('clicking an existing user card opens Work filtered to that identity and Show everyone clears it',async()=>{
  const {c}=fixture();c.apiFetch=async()=>response(roster);await c.refreshTeamRoster();c.renderVals().board.find(person=>person.name==='Zayna Azem').go();assert.equal(c.state.view,'work');assert.equal(c.state.proj,'all');assert.equal(c.state.wGroup,'owner');let values=c.renderVals();assert.equal(values.workPersonLabel,'Zayna Azem');assert.deepEqual(plain(values.workGroups.flatMap(group=>group.items.map(row=>row.title))),['Staff account ID task','Staff email task']);values.clearWorkPerson();values=c.renderVals();assert.equal(values.workPersonLabel,'');
});

test('a newly added user card opens their assigned tasks even before db.users refreshes',async()=>{
  const {c}=fixture();c.apiFetch=async()=>response(roster);await c.refreshTeamRoster();assert.ok(!c.state.db.users.some(person=>person.auth_user_id==='u_new'));c.renderVals().board.find(person=>person.name==='New Teammate').go();let values=c.renderVals();assert.equal(values.workPersonLabel,'New Teammate');assert.deepEqual(plain(values.workGroups.flatMap(group=>group.items.map(row=>row.title))),['New teammate task']);values.clearWorkPerson();values=c.renderVals();assert.ok(values.workGroups.flatMap(group=>group.items).some(row=>row.title==='New teammate task'));
});

test('a renamed roster user keeps legacy name assignments in counts and Work drilldown',async()=>{
  const {c}=fixture();c.state.db.todos[1].assignee='Zayna Azem';const renamed=plain(roster);renamed[1].name='Zayna Updated';c.apiFetch=async()=>response(renamed);await c.refreshTeamRoster();const person=c.renderVals().board.find(row=>row.name==='Zayna Updated');assert.equal(person.total,'2');person.go();const values=c.renderVals();assert.equal(values.workPersonLabel,'Zayna Updated');assert.equal(values.workGroups.flatMap(group=>group.items).length,2);
});

test('staff Command centre shows only their scoped work and never fetches the administrator roster',async()=>{
  const {c}=fixture({staff:true});let reads=0;c.apiFetch=async()=>{reads++;throw Error('Staff must not request /api/users');};c.state.teamRoster=roster;await c.refreshTeamRoster();const values=c.renderVals();assert.equal(reads,0);assert.equal(values.board.length,1);assert.equal(values.board[0].name,'Zayna Azem');assert.equal(values.board[0].total,'2');assert.equal(values.commandTeamTitle,'Your workload');assert.equal(values.commandTeamCount,'');assert.equal(values.commandHasAttention,false);assert.equal(values.commandUnassigned,'');assert.ok(values.commandAgenda.every(item=>!item.title.includes('Owner')&&!item.title.includes('New teammate')));values.board[0].go();assert.equal(c.state.wScope,'mine');assert.equal(c.state.wAssignee,null);
});

test('staff roster remains self-only even if an older cached user list contains other people',()=>{
  const {c,full}=fixture({staff:true});c.state.db.users=full.users;const values=c.renderVals();assert.deepEqual(plain(values.board.map(person=>person.name)),['Zayna Azem']);assert.equal(values.commandTeamCount,'');
});

test('Command centre excludes private names and tasks even with an inherited full administrator cache',()=>{
 const {c,full,user}=fixture({staff:true,sections:['today','work','calendar','meetings']});c.state.db=full;c.state.teamRoster=roster;
 const at='2026-10-07T14:00:00.000Z';
 c.state.db.meetings=[{id:'mine',topic:'My scheduled meeting',kind:'Assigned discussion',assignee_user_id:user.id,at},{id:'hosted',topic:'My hosted meeting',kind:'Assigned host discussion',host_user_id:user.id,at},{id:'private',topic:'PRIVATE PERSON meeting',kind:'PRIVATE PERSON appointment',assignee_user_id:'u_private',host_user_id:user.id,at},{id:'unassigned',topic:'PRIVATE PERSON unassigned meeting',kind:'Private unassigned',at}];
 c.state.db.reminders=[{id:'own_reminder',title:'My callback',kind:'Call',assignee_user_id:user.id,at},{id:'foreign_reminder',title:'PRIVATE PERSON follow-up',kind:'Call',assignee_user_id:'u_private',at}];
 const values=c.renderVals();assert.deepEqual(plain(values.board.map(x=>x.name)),['Zayna Azem']);
 assert.deepEqual(plain(values.commandAgenda.filter(x=>x.type==='Meeting').map(x=>x.title)),['My scheduled meeting','My hosted meeting']);
 const visible=JSON.stringify({board:values.board,agenda:values.commandAgenda,attention:values.commandAttention});assert.doesNotMatch(visible,/PRIVATE PERSON|Owner task|New teammate task|Ibrar Ul Islam|New Teammate/);
});

test('staff Work drilldown ignores inherited Everyone scope, other timers and other assignment labels',()=>{
 const {c,full,user}=fixture({staff:true});c.state.db=full;c.state.teamRoster=roster;c.state.view='work';c.state.proj='all';c.state.wScope='all';
 c.state.db.todos[2].assignee='PRIVATE PERSON';c.state.db.todos[2].assignee_user_id=user.id;c.state.db.todos[0].timer={running:true,started_at:'2026-10-07T10:00:00.000Z'};
 for(const group of ['module','day','owner','client']){c.state.wGroup=group;const values=c.renderVals(),rows=values.workGroups.flatMap(g=>g.items);assert.deepEqual(plain(rows.map(r=>r.title)).sort(),['Staff account ID task','Staff email task'].sort());assert.ok(rows.every(r=>r.assignee==='Zayna Azem'));assert.ok(!values.activeTimers.some(r=>r.title==='Owner task'));assert.doesNotMatch(JSON.stringify({groups:values.workGroups,timers:values.activeTimers}),/PRIVATE PERSON|Ibrar Ul Islam|New Teammate/);}
});

test('staff identity ignores a former administrator ID retained in local view state',()=>{
 const {c,full}=fixture({staff:true,sections:['today','work','calendar','meetings']});c.state.db=full;c.state.teamRoster=roster;c.state.meId='legacy_owner';
 assert.equal(c.actor(),'Zayna Azem');assert.equal(c.assignedToMe(full.todos[0]),false);assert.equal(c.assignedToMe(full.todos[1]),true);
 let values=c.renderVals();assert.deepEqual(plain(values.board.map(row=>row.name)),['Zayna Azem']);assert.equal(values.board[0].total,'2');assert.doesNotMatch(JSON.stringify(values.commandAgenda),/Owner task|Ibrar Ul Islam/);
 c.state.view='work';c.state.proj='all';c.state.wScope='all';c.state.wGroup='owner';values=c.renderVals();assert.deepEqual(plain(values.workGroups.map(group=>group.label)),['Zayna Azem']);assert.ok(values.workGroups[0].items.every(row=>row.assignee==='Zayna Azem'));
});

test('today permission alone offers no team or removed work data',()=>{
  const {c}=fixture({staff:true,sections:['today']});const values=c.renderVals();assert.equal(values.canShowWork,false);assert.equal(values.commandAgenda.length,0);assert.equal(values.commandAgendaEmpty,true);assert.equal(values.commandAttention.length,0);assert.equal(c.state.db.todos.length,0);
});

test('meeting and calendar access without Contacts opens the assigned meeting from today actions',()=>{
  const {c,user,full}=fixture({staff:true,sections:['today','calendar','meetings'],contacts:true});full.meetings=[{id:'m1',contact_id:'c1',kind:'Scheduled demo',assignee_user_id:user.id,at:'2026-10-07T14:00:00.000Z',timezone:'America/New_York',summary_status:'available',summary_text:'Fictional assigned summary'}];c.state.db=c.normalizeScopedWorkspace(scopeSnapshot(full,user));const meeting=c.renderVals().commandAgenda.find(item=>item.type==='Meeting');assert.ok(meeting);meeting.go();assert.equal(c.state.meetOpen,'m1');assert.ok(!c.state.contactId);assert.equal(c.renderVals().mt.hasContact,false);
});

test('calendar-only staff can open a reminder action without hidden Contact navigation',()=>{
  const {c,user,full}=fixture({staff:true,sections:['today','calendar'],contacts:true});full.reminders=[{id:'r1',contact_id:'c1',kind:'Email',title:'Assigned follow-up',assignee_user_id:user.id,at:'2026-10-07T15:00:00.000Z',timezone:'America/New_York',done:false}];c.state.db=c.normalizeScopedWorkspace(scopeSnapshot(full,user));const reminder=c.renderVals().commandAgenda.find(item=>item.type==='Reminder');assert.ok(reminder);reminder.go();assert.equal(c.state.view,'calendar');assert.ok(!c.state.contactId);
});

test('Command centre day boundary follows Pakistan time for meetings and due work',()=>{
  const previousZone=process.env.TZ;process.env.TZ='UTC';try{
  const {c}=fixture();c.state.now=Date.parse('2026-10-07T21:00:00.000Z');c.state.db.meetings=[{id:'m_today',kind:'PKT current day',at:'2026-10-07T20:00:00.000Z',timezone:'Asia/Karachi'},{id:'m_next',kind:'PKT next day',at:'2026-10-08T20:00:00.000Z',timezone:'Asia/Karachi'}];
  const sample={status:'Open',op_status:'Not Started',module:'03',source:'Requested',assignee:'Ibrar Ul Islam',due_tz:'Asia/Karachi',time_logs:[]};c.state.db.todos=[{...sample,id:'today',title:'PKT due today',due_at:'2026-10-08T18:30:00.000Z'},{...sample,id:'next',title:'PKT due next day',due_at:'2026-10-08T19:30:00.000Z'}];
  const values=c.renderVals();assert.match(values.commandDayLabel,/October 8/);assert.deepEqual(plain(values.commandAgenda.filter(item=>item.type==='Meeting').map(item=>item.meta)),['PKT current day']);assert.ok(values.commandAgenda.some(item=>item.title==='PKT due today'));assert.ok(!values.commandAgenda.some(item=>item.title==='PKT due next day'));
  }finally{if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone;}
});

test('removed work never appears in Command centre counts or today actions',()=>{
  const {c}=fixture();c.state.db.todos.push({...c.state.db.todos[0],id:'removed',title:'Deleted old work',due_at:'2026-10-06T14:00:00.000Z',deleted_at:'2026-10-06T14:01:00.000Z'},{...c.state.db.todos[0],id:'archived',title:'Archived old work',due_at:'2026-10-06T14:00:00.000Z',archived_at:'2026-10-06T14:01:00.000Z'});const values=c.renderVals();assert.equal(values.board[0].total,'1');assert.ok(!values.commandAgenda.some(item=>/Deleted old|Archived old/.test(item.title)));assert.ok(!values.commandAttention.some(item=>/Deleted old|Archived old/.test(item.title)));
});

test('removed meetings and reminders do not reappear in Today’s actions',()=>{
  const {c}=fixture();const at='2026-10-07T14:00:00.000Z';c.state.db.meetings=[{id:'m1',kind:'Archived manual meeting',at,archived_at:at},{id:'m2',kind:'Deleted manual meeting',at,deleted_at:at}];c.state.db.reminders=[{id:'r1',kind:'Email',title:'Archived reminder',at,archived_at:at,done:false},{id:'r2',kind:'Call',title:'Deleted reminder',at,deleted_at:at,done:false}];const values=c.renderVals();assert.ok(!values.commandAgenda.some(row=>row.type==='Meeting'||row.type==='Reminder'));
});

test('roster refresh preserves the workspace object, revision and pending edits',async()=>{
  const {c,saves}=fixture({contacts:true});let resolve;const oldDb=c.state.db,oldEtag=c._snapshotEtag;c.apiFetch=()=>new Promise(done=>{resolve=done;});const pending=c.refreshTeamRoster();c.state.db.contacts[0].brokerage='Pending edit during roster fetch';c._saveEpoch=4;resolve(response(roster));await pending;assert.equal(c.state.db,oldDb);assert.equal(c.state.db.contacts[0].brokerage,'Pending edit during roster fetch');assert.equal(c._snapshotEtag,oldEtag);assert.equal(c._saveEpoch,4);assert.equal(c._savedEpoch,2);assert.equal(saves(),0);
});

test('only the newest roster response wins when refresh requests overlap',async()=>{
  const {c}=fixture();const complete=[];c.apiFetch=()=>new Promise(done=>complete.push(done));const earlier=c.refreshTeamRoster(),later=c.refreshTeamRoster();complete[1](response(roster));await later;complete[0](response([roster[0]]));await earlier;assert.equal(c.state.teamRoster.length,5);
});

test('late roster replies cannot restore cached users after revocation or identity change',async()=>{
  for(const revoke of [true,false]){const {c}=fixture();let complete;c.apiFetch=()=>new Promise(done=>{complete=done;});const pending=c.refreshTeamRoster();if(revoke)c.state={...c.state,db:null,accessUser:null,teamRoster:null};else c.state.accessUser={...c.state.accessUser,id:'another-owner',email:'another@example.test'};complete(response(roster));await pending;assert.ok(!c.state.teamRoster);}
});

test('failed roster refresh retains the last list and shows a retry notice without dirtying the workspace',async()=>{
  const {c,saves}=fixture();c.state.teamRoster=plain(roster);const oldRoster=c.state.teamRoster,oldDb=c.state.db;c.apiFetch=async()=>({ok:false,status:503});await c.refreshTeamRoster();assert.equal(c.state.teamRoster,oldRoster);assert.equal(c.state.db,oldDb);assert.match(c.renderVals().commandRosterError,/Refresh failed/);assert.equal(saves(),0);c.apiFetch=async()=>response(roster);await c.renderVals().retryTeamRoster();assert.equal(c.state.teamRosterError,'');
});

test('compact command source compiles and keeps markup correctly nested',()=>{
  assert.match(code,/Compact command centre v1/);assert.doesNotThrow(()=>new vm.Script(code));const markup=template.slice(0,template.indexOf('<script type="text/x-dc"'));
  for(const tag of ['div','section','sc-if','sc-for']){let depth=0;for(const match of markup.matchAll(new RegExp('<\\/?'+tag+'\\b[^>]*>','g'))){depth+=match[0].startsWith('</')?-1:1;assert.ok(depth>=0,tag);}assert.equal(depth,0,tag);}
});
