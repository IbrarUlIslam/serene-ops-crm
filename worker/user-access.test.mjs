import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {scopeSnapshot,mergeScopedWrite,isPrimaryOwner,handleUsers,attachVisibility,allowedStaffRoute} from './user-access.mjs';
const user={id:'u_zayna',orgId:'org1',email:'zaynazem@gmail.com',name:'Zayna Azem',isOwner:false,visibility:{sections:['today','work','clients','tickets','activity'],editSections:['work','tickets'],scope:'assigned'}};
const db={users:[{id:'u1',name:'Ibrar',email:'owner@test.com',role:'Owner / Admin'},{id:'u2',name:user.name,email:user.email}],contacts:[{id:'c1',name:'Assigned client',status:'Client',owner_user_id:user.id,monthly_override:500,notes:'sensitive'},{id:'c2',name:'Other client'}],todos:[{id:'t1',contact_id:'c1',assignee:user.name,status:'Open'},{id:'t2',contact_id:'c2',assignee:'Ibrar',status:'Open'},{id:'t3',contact_id:'c2',assignee:'',status:'Open'}],tickets:[{id:'k1',contact_id:'c1',assignee_user_id:'u2',status:'Open'}],deals:[{id:'d1'}],access:[{secret:'never'}],files:[{id:'f1',contact_id:'c1'},{id:'f2',contact_id:'c2'},{id:'audit',contact_id:'c1',audit_report_id:'a'}],activity:[{who:user.name},{who:'Ibrar'}],org:{capacity_hours:230},user_prefs:{u1:{secret:1},u2:{calTZ:'Asia/Karachi'}}};
test('only the primary Ibrar account matches protected primary ownership',()=>{assert.equal(isPrimaryOwner({id:'u_ibrar',roleCode:'owner_admin'}),true);assert.equal(isPrimaryOwner({id:'u_zayna',roleCode:'owner_admin'}),false);});
test('staff receive assigned work only, no unassigned items or other users and no commercial fields',()=>{const view=scopeSnapshot(db,user);assert.deepEqual(view.todos.map(x=>x.id),['t1']);assert.deepEqual(view.contacts.map(x=>x.id),['c1']);assert.equal(view.contacts[0].monthly_override,undefined);assert.equal(view.contacts[0].notes,undefined);assert.equal(view.users.length,1);assert.deepEqual(view.deals,[]);assert.deepEqual(view.access,[]);assert.deepEqual(view.files.map(x=>x.id),['f1']);assert.equal(view.user_prefs.u1,undefined);});
test('hidden sections remove data even where assignment matches',()=>{const view=scopeSnapshot(db,{...user,visibility:{sections:[],editSections:[]}});assert.deepEqual(view.todos,[]);assert.deepEqual(view.contacts,[]);assert.deepEqual(view.tickets,[]);});
test('staff updates merge into full snapshot without deleting others or granting themselves roles',()=>{const incoming=scopeSnapshot(db,user);incoming.todos[0].status='Done';incoming.todos[0].assignee='Ibrar';incoming.users[0].role='Owner / Admin';incoming.contacts=[];incoming.access=[{secret:'injected'}];const merged=mergeScopedWrite(db,incoming,user);assert.equal(merged.todos[0].status,'Done');assert.equal(merged.todos[0].assignee,user.name);assert.equal(merged.todos[1].status,'Open');assert.equal(merged.contacts.length,2);assert.equal(merged.access[0].secret,'never');assert.equal(merged.users.length,2);});
test('staff cannot forge another record or create a task assigned to another person',()=>{assert.throws(()=>mergeScopedWrite(db,{todos:[{id:'t2',status:'Done'}]},user),/only your assigned/);assert.throws(()=>mergeScopedWrite(db,{todos:[{id:'new'}]},user),/only your assigned/);});
test('read-only users cannot update tasks, and public source evidence is not reachable through other endpoints',()=>{assert.throws(()=>mergeScopedWrite(db,{todos:[{id:'t1',status:'Done'}]},{...user,visibility:{sections:['work'],editSections:[]}}),/read-only/);for(const p of ['/api/users','/api/audits','/api/contacts','/api/zoho/mail/folders','/api/reports'])assert.equal(allowedStaffRoute(p),false);assert.equal(allowedStaffRoute('/api/db'),true);});
test('user administration rejects a contributor before reading storage',async()=>{const result=await handleUsers(new Request('https://crm.test/api/users'),{},user);assert.equal(result.status,403);});
test('missing visibility storage fails to assigned read-only rather than granting owner',async()=>{const result=await attachVisibility({DB:{prepare(){throw Error('missing');}}},{...user,roleCode:'owner_admin'});assert.equal(result.isOwner,false);assert.equal(result.visibility.scope,'assigned');assert.deepEqual(result.visibility.editSections,[]);});
test('Ibrar can provision contributors and save visibility without a second administrator',async()=>{const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,email TEXT UNIQUE,role_id TEXT,status TEXT,created_at TEXT DEFAULT 'now',updated_at TEXT,deleted_at TEXT);CREATE TABLE user_visibility(org_id TEXT,user_id TEXT,sections_json TEXT,edit_sections_json TEXT,updated_at TEXT,PRIMARY KEY(org_id,user_id));INSERT INTO users VALUES('u_ibrar','org1','Ibrar','owner@test.com','role_owner','active','now',NULL,NULL);");const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});const env={DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};const actor={id:'u_ibrar',orgId:'org1',isOwner:true};const req=(path,method,body)=>new Request('https://crm.test/api/users'+path,{method,body:JSON.stringify(body)});let result=await handleUsers(req('','POST',{name:'Example Staff',email:'staff@example.com',sections:['work'],editSections:['work'],isOwner:true}),env,actor);assert.equal(result.status,200);const created=await result.json();assert.equal(sql.prepare('SELECT role_id FROM users WHERE id=?').get(created.id).role_id,'role_contributor');assert.equal(sql.prepare('SELECT sections_json FROM user_visibility WHERE user_id=?').get(created.id).sections_json,'["work"]');result=await handleUsers(req('/u_ibrar','PUT',{sections:[],editSections:[],status:'disabled'}),env,actor);assert.equal(result.status,409);result=await handleUsers(req('/'+created.id,'PUT',{sections:['work'],editSections:[],status:'disabled'}),env,actor);assert.equal(result.status,200);assert.equal(sql.prepare('SELECT status FROM users WHERE id=?').get(created.id).status,'disabled');result=await handleUsers(req('/'+created.id,'PUT',{sections:['work'],editSections:[],status:'active'}),env,{...actor,orgId:'other'});assert.equal(result.status,404);sql.close();});
test('removing a section removes its data from dashboard and calendar aliases, context and activity',()=>{
 const source={...db,contacts:[{...db.contacts[0],email:'private@example.com',phone:'123',brokerage:'Private brokerage',timezone:'America/New_York'}],meetings:[{id:'m1',assignee:user.name,contact_id:'c1',notes:'Meeting secret'}],todos:[...db.todos,{id:'socialtask',assignee:user.name,social_post_id:'p1',contact_id:'c1'},{id:'soptask',assignee:user.name,sop_instance_id:'si1',contact_id:'c1'}],activity:[{who:user.name,what:'Task set to Done',target:{recordId:'t1',section:'work'}},{who:user.name,what:'Meeting created'},{who:user.name,what:'Contact updated'},{who:user.name,what:'Unclassified private action'}]};
 const removed=scopeSnapshot(source,{...user,visibility:{sections:['today','calendar','activity'],editSections:[]}});
 assert.deepEqual(removed.todos,[]);assert.deepEqual(removed.meetings,[]);assert.deepEqual(removed.contacts,[]);assert.deepEqual(removed.activity,[]);
 const workOnly=scopeSnapshot(source,{...user,visibility:{sections:['work','activity'],editSections:['work']}});
 assert.deepEqual(workOnly.todos.map(t=>t.id),['t1']);assert.deepEqual(workOnly.contacts,[{id:'c1',name:'Assigned client',timezone:'America/New_York'}]);assert.deepEqual(workOnly.activity.map(x=>x.what),['Task set to Done']);
 assert.throws(()=>mergeScopedWrite(source,{todos:[{id:'t1',status:'Done'}]},{...user,visibility:{sections:['today'],editSections:[]}}),/no longer available/);
});
test('assigned SOP completion advances saved steps without trusting changed templates or new record fields',()=>{
 const source={...structuredClone(db),todos:[{id:'sop1',assignee:user.name,contact_id:'c1',status:'Open',sop_instance_id:'si1',sop_step_id:'first',evidence_required:true}],sop_instances:[{id:'si1',assignee:user.name,contact_id:'c1',status:'Active',template_snapshot:{steps:[{id:'first',title:'Check supplied records'},{id:'approval',title:'Approve handoff',depends_on:['first'],approval:true}]},completed:{},history:[]}]};
 const allowed={...user,visibility:{sections:['work','sops'],editSections:['work']}};
 const incoming=scopeSnapshot(source,allowed);incoming.todos[0].status='Done';incoming.todos[0].completion_note='Checked source example.';incoming.sop_instances[0].template_snapshot.steps[1].approval=false;incoming.sop_instances[0].template_snapshot.steps[1].title='Forged';
 const merged=mergeScopedWrite(source,incoming,allowed);
 assert.equal(merged.sop_instances[0].completed.first.by,user.name);assert.equal(merged.sop_instances[0].history.length,1);assert.equal(merged.todos.length,2);assert.equal(merged.todos[1].title,'Approve handoff');assert.equal(merged.todos[1].assignee,'Ibrar');assert.equal(scopeSnapshot(merged,allowed).todos.length,1);assert.equal(source.sop_instances[0].history.length,0);
 const noEvidence=scopeSnapshot(source,allowed);noEvidence.todos[0].status='Done';assert.throws(()=>mergeScopedWrite(source,noEvidence,allowed),/requires evidence/);
});
test('recurring completion creates one fresh successor and cannot inject arbitrary work',()=>{
 const source={...structuredClone(db),todos:[{id:'rec1',contact_id:'c1',assignee:user.name,title:'Follow up',status:'Open',due_at:'2026-10-07T14:00:00.000Z',due_tz:'America/New_York',recurrence:{repeat:'Weekly',interval:1,endType:'Never ends'},completion_note:'Old note',time_logs:[]}]};
 const incoming=scopeSnapshot(source,user);incoming.todos[0].status='Done';
 const merged=mergeScopedWrite(source,incoming,user);assert.equal(merged.todos.length,2);assert.equal(merged.todos[1].due_at,'2026-10-14T14:00:00.000Z');assert.equal(merged.todos[1].completion_note,'');assert.equal(merged.todos[1].status,'Open');assert.equal(mergeScopedWrite(merged,scopeSnapshot(merged,user),user).todos.length,2);
 incoming.todos.push({id:'forged',title:'Arbitrary'});assert.throws(()=>mergeScopedWrite(source,incoming,user),/only your assigned/);
});
test('assigned ticket statuses derive linked work and close running time logs',()=>{
 const source={...structuredClone(db),todos:[],tickets:[{id:'k1',title:'Check listing',module:'02',type:'Problem',contact_id:'c1',assignee:user.name,status:'New'}]};
 let incoming=scopeSnapshot(source,user);incoming.tickets[0].status='Assigned';let merged=mergeScopedWrite(source,incoming,user);assert.equal(merged.todos.length,1);assert.equal(merged.todos[0].ticket_id,'k1');assert.equal(merged.todos[0].assignee,user.name);assert.equal(merged.todos[0].title,'Check listing');
 merged.todos[0].time_logs=[{start_at:'2026-10-07T00:00:00.000Z'}];incoming=scopeSnapshot(merged,user);incoming.tickets[0].status='Query done';const done=mergeScopedWrite(merged,incoming,user);assert.equal(done.todos[0].status,'Done');assert.ok(done.todos[0].time_logs[0].end_at);assert.ok(done.tickets[0].closed_at);
});
test('publishing assigned approved social posts records a server timestamp and approval remains mandatory',()=>{
 const allowed={...user,visibility:{sections:['social'],editSections:['social']}};
 const source={...structuredClone(db),social_posts:[{id:'p1',assignee:user.name,status:'Approved',approval_required:true}]};
 const incoming=scopeSnapshot(source,allowed);incoming.social_posts[0].status='Published';incoming.social_posts[0].published_at='forged';const merged=mergeScopedWrite(source,incoming,allowed);assert.ok(Number.isFinite(Date.parse(merged.social_posts[0].published_at)));assert.notEqual(merged.social_posts[0].published_at,'forged');source.social_posts[0].status='Waiting approval';assert.throws(()=>mergeScopedWrite(source,incoming,allowed),/requires approval/);
});
test('hidden social and SOP work never survives through same-actor activity prose or linked targets',()=>{
 const source={...structuredClone(db),todos:[...db.todos,{id:'social1',assignee:user.name,contact_id:'c1',title:'Publish private campaign',social_post_id:'p1'},{id:'sop1',assignee:user.name,contact_id:'c1',title:'Verify private workflow',sop_instance_id:'si1'}],social_posts:[{id:'p1',title:'Private campaign',assignee:user.name}],sop_instances:[{id:'si1',title:'Private workflow',assignee:user.name}],activity:[
  {id:'visible',who:user.name,what:'Task set to Done',target:{recordId:'t1',section:'work'}},
  {id:'social-prose',who:user.name,what:'Task done: Publish private campaign',contact_id:'c1'},
  {id:'sop-prose',who:user.name,what:'Task done: Verify private workflow',contact_id:'c1'},
  {id:'social-target',who:user.name,what:'Task completed',target:{recordId:'social1',section:'work'}},
  {id:'sop-target',who:user.name,what:'Task completed',target:{taskId:'sop1'}},
  {id:'ambiguous',who:user.name,what:'Task set to Done',contact_id:'c1'},
  {id:'social-direct',who:user.name,what:'Social post published',target:{socialPostId:'p1'}},
  {id:'other-assignee',who:user.name,what:'Task completed',target:{recordId:'t2',section:'work'}}
 ]};
 const viewer={...user,visibility:{sections:['work','activity'],editSections:['work']}};
 const result=scopeSnapshot(source,viewer);assert.deepEqual(result.activity.map(r=>r.id),['visible']);
 assert.equal(JSON.stringify(result).includes('private campaign'),false);assert.equal(JSON.stringify(result).includes('private workflow'),false);
});
test('task type choices include only those referenced by visible assigned work',()=>{
 const source={...structuredClone(db),todos:[{id:'visible',assignee:user.name,task_type_id:'normal'},{id:'hidden',assignee:user.name,social_post_id:'p1',task_type_id:'campaign'}],task_types:[{id:'normal',name:'Review records'},{id:'campaign',name:'Private campaign production'},{id:'unused',name:'Other source choice'}]};
 const viewer={...user,visibility:{sections:['work'],editSections:['work']}};
 assert.deepEqual(scopeSnapshot(source,viewer).task_types,[{id:'normal',name:'Review records'}]);
 assert.deepEqual(scopeSnapshot(source,{...viewer,visibility:{sections:[],editSections:[]}}).task_types,[]);
});
test('contributors cannot approve or reschedule a social post through snapshot status changes',()=>{
 const viewer={...user,visibility:{sections:['social'],editSections:['social']}};
 const source={...structuredClone(db),social_posts:[{id:'p1',assignee:user.name,status:'Waiting approval',approval_required:true}]};
 for(const status of ['Approved','Ready','Scheduled','Draft']){const incoming=scopeSnapshot(source,viewer);incoming.social_posts[0].status=status;assert.throws(()=>mergeScopedWrite(source,incoming,viewer),/Only Ibrar/);}
 assert.equal(source.social_posts[0].status,'Waiting approval');
});
test('approved captions cannot be changed by contributors before or after publication',()=>{
 const viewer={...user,visibility:{sections:['social'],editSections:['social']}};
 for(const status of ['Approved','Ready','Published']){const source={...structuredClone(db),social_posts:[{id:'p1',assignee:user.name,status,approval_required:true,caption:'Approved copy'}]};const incoming=scopeSnapshot(source,viewer);incoming.social_posts[0].caption='Changed without review';incoming.social_posts[0].status='Published';assert.throws(()=>mergeScopedWrite(source,incoming,viewer),/Ask Ibrar to return/);assert.equal(source.social_posts[0].caption,'Approved copy');}
 const source={...structuredClone(db),social_posts:[{id:'draft',assignee:user.name,status:'Draft',approval_required:true,caption:'Draft copy'}]};const incoming=scopeSnapshot(source,viewer);incoming.social_posts[0].caption='A new draft';assert.equal(mergeScopedWrite(source,incoming,viewer).social_posts[0].caption,'A new draft');
});
test('operational assignment takes precedence over an unrelated owner or meeting host',()=>{
 const source={...structuredClone(db),todos:[{id:'other',assignee:'Other person',owner_user_id:user.id},{id:'unassigned',assignee:'Unassigned',owner_user_id:user.id},{id:'mine',assignee:user.name,owner_user_id:'u_ibrar'}],tickets:[{id:'ticketOther',assignee:'Other person',owner_user_id:user.id}],meetings:[{id:'hostOther',assignee:'Other person',host_user_id:user.id},{id:'hostMine',host_user_id:user.id}],contacts:[{id:'assignedContact',owner_user_id:user.id,status:'Client',name:'Owned contact'}]};
 const viewer={...user,visibility:{sections:['work','tickets','meetings','contacts'],editSections:['work']}};
 const result=scopeSnapshot(source,viewer);assert.deepEqual(result.todos.map(x=>x.id),['mine']);assert.deepEqual(result.tickets,[]);assert.deepEqual(result.meetings.map(x=>x.id),['hostMine']);assert.deepEqual(result.contacts.map(x=>x.id),['assignedContact']);
 assert.throws(()=>mergeScopedWrite(source,{todos:[{id:'other',status:'Done'}]},viewer),/only your assigned/);
});
test('an SOP-only view has minimal client context and cannot complete an administrator approval step',()=>{
 const source={...structuredClone(db),todos:[{id:'approval',assignee:user.name,contact_id:'c1',status:'Open',sop_instance_id:'si1',sop_step_id:'check'}],sop_instances:[{id:'si1',assignee:user.name,contact_id:'c1',status:'Active',template_snapshot:{steps:[{id:'check',title:'Approve final handoff',approval:true}]}}]};
 const viewer={...user,visibility:{sections:['sops'],editSections:[]}};const result=scopeSnapshot(source,viewer);assert.equal(result.sop_instances.length,1);assert.deepEqual(result.contacts,[{id:'c1',name:'Assigned client',timezone:undefined}]);assert.deepEqual(result.todos,[]);
 const worker={...user,visibility:{sections:['work','sops'],editSections:['work']}};const incoming=scopeSnapshot(source,worker);incoming.todos[0].status='Done';assert.throws(()=>mergeScopedWrite(source,incoming,worker),/Only Ibrar can approve/);
});
test('missing or corrupted visibility grants no sections and unknown stored edit privileges are dropped',async()=>{
 const make=row=>({DB:{prepare(){return {bind(){return {first:async()=>row};}};}}});
 for(const row of [null,{sections_json:'broken',edit_sections_json:'[]'},{sections_json:'null',edit_sections_json:'[]'}]){const result=await attachVisibility(make(row),{...user});assert.deepEqual(result.visibility.sections,[]);assert.deepEqual(result.visibility.editSections,[]);}
 const result=await attachVisibility(make({sections_json:'["work","users","audits"]',edit_sections_json:'["work","users","social"]'}),{...user});assert.deepEqual(result.visibility.sections,['work']);assert.deepEqual(result.visibility.editSections,['work']);
});
test('ticket completion cannot indirectly close another person’s task or an approval step',()=>{
 const source={...structuredClone(db),tickets:[{id:'k1',assignee:user.name,status:'Assigned'}],todos:[{id:'linked',ticket_id:'k1',assignee:'Ibrar',status:'Open'}]};
 let incoming=scopeSnapshot(source,user);incoming.tickets[0].status='Query done';assert.throws(()=>mergeScopedWrite(source,incoming,user),/assigned to another person/);assert.equal(source.todos[0].status,'Open');
 source.todos[0].assignee=user.name;source.todos[0].social_post_id='p1';source.todos[0].title='Approve listing copy';source.social_posts=[{id:'p1',status:'Waiting approval'}];incoming=scopeSnapshot(source,user);incoming.tickets[0].status='Query done';assert.throws(()=>mergeScopedWrite(source,incoming,user),/Only Ibrar can close/);
});
test('ticket state automation preserves another assignee’s work status',()=>{
 const source={...structuredClone(db),tickets:[{id:'k1',assignee:user.name,status:'Assigned'}],todos:[{id:'linked',ticket_id:'k1',assignee:'Ibrar',status:'Open',op_status:'Not Started'}]};
 for(const status of ['In progress','Waiting on client feedback']){const incoming=scopeSnapshot(source,user);incoming.tickets[0].status=status;const result=mergeScopedWrite(source,incoming,user);assert.equal(result.tickets[0].status,status);assert.equal(result.todos[0].op_status,'Not Started');}
});
test('contact and document permissions cannot expand through assignment to a related work item',()=>{
 const source={...structuredClone(db),contacts:[{id:'c1',name:'Context only',timezone:'America/New_York',owner_user_id:'u_ibrar',email:'private@example.com',phone:'555',brokerage:'Private details',status:'Client'}]};
 const viewer={...user,visibility:{sections:['work','contacts','clients'],editSections:['work']}};
 const result=scopeSnapshot(source,viewer);assert.deepEqual(result.contacts,[{id:'c1',name:'Context only',timezone:'America/New_York'}]);assert.deepEqual(result.files,[]);assert.equal(JSON.stringify(result).includes('private@example.com'),false);
 source.contacts[0].owner_user_id=user.id;const granted=scopeSnapshot(source,viewer);assert.equal(granted.contacts[0].email,'private@example.com');assert.deepEqual(granted.files.map(f=>f.id),['f1']);
});
test('hidden section preferences are excluded without being deleted or edited by a scoped autosave',()=>{
 const source={...structuredClone(db),user_prefs:{u2:{workViews:[{label:'Work secret'}],contactViews:[{label:'Contact secret'}],calTZ:'UTC',focus:{state:'work'},theme:'cream'}}};
 const viewer={...user,visibility:{sections:['tickets'],editSections:['tickets']}};
 const result=scopeSnapshot(source,viewer);assert.deepEqual(result.user_prefs.u2,{theme:'cream'});
 result.user_prefs.u2.workViews=[{label:'Injected'}];result.user_prefs.u2.contactViews=[];result.user_prefs.u2.theme='ink';const merged=mergeScopedWrite(source,result,viewer);assert.deepEqual(merged.user_prefs.u2.workViews,[{label:'Work secret'}]);assert.deepEqual(merged.user_prefs.u2.contactViews,[{label:'Contact secret'}]);assert.equal(merged.user_prefs.u2.theme,'ink');
});
test('completed SOP steps require owner workflow rollback rather than crafted contributor status edits',()=>{
 const source={...structuredClone(db),todos:[{id:'done',assignee:user.name,status:'Done',op_status:'Complete',sop_instance_id:'si1',sop_step_id:'s1'}]};
 const viewer={...user,visibility:{sections:['work','sops'],editSections:['work']}};
 for(const change of [{status:'Open',op_status:'Not Started'},{status:'Cancelled',op_status:'Cancelled'},{op_status:'In Progress'}]){const incoming=scopeSnapshot(source,viewer);Object.assign(incoming.todos[0],change);assert.throws(()=>mergeScopedWrite(source,incoming,viewer),/Ask Ibrar to roll back/);}
 const owner={id:'u_ibrar',isOwner:true};const incoming=structuredClone(source);incoming.todos[0].status='Open';assert.equal(mergeScopedWrite(source,incoming,owner).todos[0].status,'Open');assert.equal(source.todos[0].status,'Done');
});
test('changed work and ticket status values must match supported UI states',()=>{
 for(const [key,id,field,value]of [['todos','t1','status','Finished'],['todos','t1','status',null],['todos','t1','op_status','InProgress'],['tickets','k1','status','Completed']]){const incoming=scopeSnapshot(db,user);incoming[key].find(r=>r.id===id)[field]=value;assert.throws(()=>mergeScopedWrite(db,incoming,user),/Choose a valid/);}
 const incoming=scopeSnapshot(db,user);incoming.todos[0].op_status='Blocked';assert.equal(mergeScopedWrite(db,incoming,user).todos[0].op_status,'Blocked');
 // Historical statuses are left untouched by unrelated autosaves.
 assert.equal(mergeScopedWrite(db,scopeSnapshot(db,user),user).tickets[0].status,'Open');
});
