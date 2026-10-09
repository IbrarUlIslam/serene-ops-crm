import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {scopeSnapshot,mergeScopedWrite} from './user-access.mjs';

const user={id:'u_staff',orgId:'org1',name:'Assigned Staff',email:'staff@example.test',isOwner:false,visibility:{sections:['today','work','tickets','social','sops','meetings','calendar','contacts','activity','calls'],editSections:['work','tickets','social','calls']}};
const privateName='Distinctive Private Teammate';
function source(){
 const assignment={assignee:privateName,assignee_user_id:user.id,assignees:[{id:'legacy_staff',name:'Incorrect other name'},{id:'u_private',name:privateName}],assigned_user_ids:[user.id,'u_private'],owner:privateName,owner_user_id:'u_private',created_by:privateName,created_by_user_id:'u_private',creator:{id:'u_private',name:privateName}};
 const task=(id,title,fields={})=>({id,title,contact_id:'client',due_at:'2026-10-08T14:00:00.000Z',due_tz:'Asia/Karachi',status:'Open',op_status:'Not Started',module:'03',source:'Requested',minutes:0,time_logs:[],...fields});
 return{users:[{id:'legacy_staff',auth_user_id:user.id,name:user.name,email:user.email,role:'Contributor'},{id:'u_private',name:privateName,email:'private@example.test',role:'Contributor'}],contacts:[{id:'client',name:'Allowed Client',status:'Client',owner:privateName,owner_user_id:'u_private',assignee_user_id:user.id,services:['03'],timezone:'America/New_York'}],
  todos:[task('mine','Assigned task',assignment),task('private','Distinctive private task',{assignee:privateName,assignee_user_id:'u_private',created_by:privateName})],
  tickets:[{id:'ticket',title:'Assigned ticket',contact_id:'client',status:'Inquiry',...assignment}],business:[{id:'business',title:'Assigned internal work',...assignment}],social_posts:[{id:'post',title:'Assigned post',contact_id:'client',status:'Draft',caption:'Keep approved workflow text intact',...assignment}],meetings:[{id:'meeting',kind:'Assigned meeting',contact_id:'client',at:'2026-10-08T13:00:00.000Z',timezone:'America/New_York',...assignment},{id:'other-meeting',kind:'Distinctive private meeting',contact_id:'client',at:'2026-10-08T13:30:00.000Z',assignee:privateName}],
  reminders:[{id:'reminder',kind:'Email',title:'Assigned reminder',contact_id:'client',at:'2026-10-08T14:00:00.000Z',timezone:'America/New_York',done:false,...assignment},{id:'other-reminder',kind:'Email',title:'Distinctive private reminder',contact_id:'client',at:'2026-10-08T14:00:00.000Z',done:false,assignee:privateName}],sop_instances:[{id:'sop',title:'Assigned workflow',status:'Active',contact_id:'client',template_id:'template',...assignment}],sop_templates:[{id:'template',title:'Workflow template',steps:[]}],activity:[],files:[],deals:[],checklists:{precall:[],onboarding:[]},user_prefs:{},org:{name:'Serene Ops',capacity_hours:230,trigger:.75}};
}

test('staff task sources return only assigned records and self identity labels, including coassignments',()=>{
 const full=source(),view=scopeSnapshot(full,user);
 assert.deepEqual(view.todos.map(t=>t.id),['mine']);assert.deepEqual(view.meetings.map(m=>m.id),['meeting']);assert.deepEqual(view.reminders.map(r=>r.id),['reminder']);
 for(const key of ['todos','tickets','business','social_posts','meetings','reminders','sop_instances']){
  const row=view[key][0];assert.equal(row.assignee,user.name,key);assert.equal(row.assignee_user_id,user.id,key);
  assert.deepEqual(row.assignees,[{id:'legacy_staff',name:user.name}],key);assert.deepEqual(row.assigned_user_ids,[user.id],key);
  for(const field of ['owner','owner_user_id','created_by','created_by_user_id','creator'])assert.equal(row[field],undefined,key+' '+field);
 }
 assert.deepEqual(view.users.map(u=>u.name),[user.name]);
 assert.equal(JSON.stringify(view).includes(privateName),false);assert.equal(JSON.stringify(view).includes('Distinctive private task'),false);
 assert.equal(full.todos[0].assignee,privateName);assert.equal(full.todos[0].creator.name,privateName);
});

test('projection keeps self authorship and preserves task wording and operational content',()=>{
 const full=source();Object.assign(full.todos[0],{created_by:user.name,created_by_user_id:user.id,creator:{user_id:user.id,name:'Wrong label',email:'unrelated@example.test'},completion_note:'Evidence supplied by the client',body:'Task description',time_logs:[{id:'own-log',by:user.name,duration_ms:60000}]});
 const row=scopeSnapshot(full,user).todos[0];assert.equal(row.created_by,user.name);assert.equal(row.created_by_user_id,user.id);assert.deepEqual(row.creator,{user_id:user.id,name:user.name});assert.equal(row.title,'Assigned task');assert.equal(row.body,'Task description');assert.equal(row.completion_note,'Evidence supplied by the client');assert.deepEqual(row.time_logs,full.todos[0].time_logs);
});

test('redacted creator, owner and coassignee metadata is never deleted by a contributor autosave',()=>{
 const full=source(),incoming=scopeSnapshot(full,user),metadata=({assignee,assignee_user_id,assignees,assigned_user_ids,owner,owner_user_id,created_by,created_by_user_id,creator})=>({assignee,assignee_user_id,assignees,assigned_user_ids,owner,owner_user_id,created_by,created_by_user_id,creator});
 full.todos[0].time_logs=[{id:'historical-log',by:privateName,by_user_id:'u_private',start_at:'2026-10-08T00:00:00.000Z',end_at:'2026-10-08T00:01:00.000Z',duration_ms:60000}];incoming.todos[0].time_logs=scopeSnapshot(full,user).todos[0].time_logs;
 incoming.todos[0].op_status='Blocked';incoming.todos[0].completion_note='Waiting for client records';
 const merged=mergeScopedWrite(full,incoming,user);
 for(const key of ['todos','tickets','business','social_posts','meetings','reminders','sop_instances'])assert.deepEqual(metadata(merged[key][0]),metadata(full[key][0]),key);
 assert.deepEqual(merged.contacts,full.contacts);assert.deepEqual(merged.todos[0].time_logs,full.todos[0].time_logs);assert.equal(merged.todos[0].op_status,'Blocked');assert.equal(merged.todos[0].completion_note,'Waiting for client records');assert.equal(merged.todos[1].title,'Distinctive private task');
});

test('owner projection keeps the complete team and all canonical task identity information',()=>{
 const full=source(),owner={...user,isOwner:true};assert.equal(scopeSnapshot(full,owner),full);assert.equal(full.todos[0].assignee,privateName);assert.equal(full.users.length,2);
});

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const template=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
function component(){
 const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,location:{hostname:'crm.sereneop.com',origin:'https://crm.sereneop.com'},document:{querySelectorAll:()=>[]},window:{scrollTo(){},addEventListener(){},removeEventListener(){},location:{reload(){}}},DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
 vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);const c=new context.ReviewComponent();c.props={};c.toast=()=>{};c.persistDb=()=>{};
 const full=c.ensureEnhancements(source());c.state={...c.state,authChecked:true,accessUser:user,dbLoadFailed:false,meIdUnresolved:false,meId:'legacy_staff',db:c.normalizeScopedWorkspace(scopeSnapshot(full,user)),teamRoster:full.users,now:Date.parse('2026-10-08T12:00:00.000Z'),view:'today'};return{c,full};
}
const plain=v=>JSON.parse(JSON.stringify(v));

test('actual bundled Command centre models display self and assigned work only with a cached private roster',()=>{
 const {c}=component(),v=c.renderVals();assert.deepEqual(plain(v.board.map(p=>p.name)),[user.name]);assert.equal(v.board[0].total,'1');assert.equal(v.commandTeamTitle,'Your workload');assert.equal(v.commandHasAttention,false);
 const display={team:v.board.map(p=>({name:p.name,total:p.total,today:p.today})),agenda:v.commandAgenda.map(a=>({type:a.type,title:a.title,meta:a.meta})),attention:v.commandAttention};
 assert.equal(JSON.stringify(display).includes(privateName),false);assert.equal(JSON.stringify(display).includes('Distinctive private'),false);assert.ok(v.commandAgenda.some(a=>a.title==='Assigned task'));assert.ok(v.commandAgenda.some(a=>a.title==='Assigned reminder'));
 assert.equal(v.commandTeamCount,'');assert.equal(v.commandUnassigned,'');
});

test('clicking a contributor workload card shows only self labels and own assigned task',()=>{
 const {c}=component();c.renderVals().board[0].go();const v=c.renderVals();assert.equal(c.state.view,'work');assert.equal(c.state.wScope,'mine');assert.equal(c.state.wAssignee,null);assert.equal(v.workPersonLabel,'');
 assert.deepEqual(plain(v.workGroups.map(g=>g.label)),[user.name]);assert.deepEqual(plain(v.workGroups.flatMap(g=>g.items.map(t=>t.title))),['Assigned task']);assert.ok(v.workGroups.flatMap(g=>g.items).every(t=>!t.assignee.includes('Private')));
});

test('removing Work removes task data and labels from staff Command centre without granting Calls data',()=>{
 const {c,full}=component();const u={...user,visibility:{sections:['today','calls'],editSections:['calls']}};c.state.accessUser=u;c.state.db=c.normalizeScopedWorkspace(scopeSnapshot(full,u));const v=c.renderVals();assert.equal(v.canShowWork,false);assert.deepEqual(plain(v.commandAgenda),[]);assert.deepEqual(c.state.db.todos,[]);assert.deepEqual(c.state.db.contacts,[]);assert.deepEqual(c.state.db.calls,[]);
});
