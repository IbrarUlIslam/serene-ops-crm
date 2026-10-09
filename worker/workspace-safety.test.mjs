import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const template=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const response=(value,status=200,etag='"2026-10-07T12:00:00.000Z"')=>({ok:status>=200&&status<300,status,headers:{get:name=>name.toLowerCase()==='etag'?etag:null},json:async()=>value});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({staff=false}={}){
  const intervals=[],timers=[],listeners=new Map(),frames=[];let reloads=0;
  const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,queueMicrotask,confirm:()=>true,
    location:{hostname:'crm.sereneop.com',origin:'https://crm.sereneop.com'},
    document:{querySelectorAll:()=>frames},
    window:{addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),location:{reload:()=>{reloads++;}},scrollTo(){}},
    setTimeout:(fn,delay)=>{const token={fn,delay};timers.push(token);if(delay===500)queueMicrotask(fn);return token;},clearTimeout(){},
    setInterval:(fn,delay)=>{const token={fn,delay};intervals.push(token);return token;},clearInterval(){},
    DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
  vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);
  const c=new context.ReviewComponent();c.props={};c.toast=message=>{c.lastToast=message;};
  const user={isOwner:!staff,email:staff?'staff@example.com':'owner@example.com',visibility:{sections:['today','work'],editSections:['work']}};
  const db={org:{id:'org1',capacity_hours:230,trigger:.75},users:[{id:'u1',name:staff?'Assigned Person':'Ibrar Ul Islam',email:user.email}],contacts:[{id:'c1',name:'Fictional save QA',timezone:'America/New_York',state:'NY',status:'Not contacted',services:[]}],deals:[],tickets:[],todos:[],checklists:{precall:[],onboarding:[]}};
  c.state={...c.state,db:c.normalizeScopedWorkspace(db),accessUser:user,authChecked:true,meId:'u1',meIdUnresolved:false,dbLoadFailed:false};c._saveEpoch=0;c._savedEpoch=0;c._snapshotEtag='"initial"';
  return {c,user,db,intervals,timers,listeners,frames,context,reloads:()=>reloads};
}

test('snapshot versions use the response timestamp despite transformed transport ETags',()=>{
  const {c}=fixture();const weak=response({},200,'W/"2026-10-07T12:00:00.000Z"');
  assert.equal(c.snapshotVersion(weak,{updatedAt:'2026-10-07T12:00:00.000Z'}),'"2026-10-07T12:00:00.000Z"');
  assert.equal(c.snapshotVersion(weak,{data:{ok:true,updatedAt:'2026-10-07T12:00:01.000Z'}}),'"2026-10-07T12:00:01.000Z"');
  assert.equal(c.snapshotVersion(weak,{updatedAt:null}),'"empty"');
  assert.equal(c.snapshotVersion(weak,{}),'"2026-10-07T12:00:00.000Z"');
});

test('editing and all persistence paths are blocked after a failed data read',async()=>{
  const {c}=fixture();let writes=0;c.apiFetch=async()=>{writes++;return response({});};c.state.dbLoadFailed=true;
  c.commit(db=>db.contacts.push({id:'danger'}),'Danger');c.commitSilently(db=>db.contacts=[]);c.persistDb();await c.flushDb();
  assert.equal(c.state.db.contacts.length,1);assert.equal(c._saveEpoch,0);assert.equal(writes,0);assert.equal(c.canView('contacts'),false);
});

test('unknown authenticated identity and pending authentication cannot save or browse sections',async()=>{
  const {c}=fixture();let writes=0;c.apiFetch=async()=>{writes++;return response({});};c.state.meIdUnresolved=true;c.commit(db=>db.contacts=[]);await c.flushDb();assert.equal(writes,0);assert.equal(c.canView('work'),false);
  c.state.meIdUnresolved=false;c.state.authChecked=false;assert.equal(c.workspaceReady(),false);c.commitSilently(db=>db.contacts=[]);assert.equal(c.state.db.contacts.length,1);
});

test('no-op maintenance does not generate a save or dirty epoch',()=>{
  const {c,timers}=fixture();c.commitSilently(db=>c.ensureRecurringOccurrences(db));assert.equal(c._saveEpoch,0);assert.equal(timers.length,0);
});

test('save sends the known revision and adopts the new server revision',async()=>{
  const {c}=fixture();let options;c.apiFetch=async(path,request)=>{assert.equal(path,'/api/db');options=request;return response({data:{ok:true,updatedAt:'later'}},200,'"next"');};
  c.commit(db=>db.contacts[0].brokerage='Saved fictional brokerage');await c.flushDb();assert.equal(options.headers['If-Match'],'"initial"');assert.match(options.body,/Saved fictional brokerage/);assert.equal(c._snapshotEtag,'"later"');assert.equal(c._savedEpoch,1);assert.equal(c.state.saveStatus,'saved');
});

test('overlapping edits are serialized and preserve the second edit',async()=>{
  const {c}=fixture();const calls=[];let resolveFirst;c.apiFetch=(path,options)=>{calls.push(options);if(calls.length===1)return new Promise(resolve=>{resolveFirst=resolve;});return Promise.resolve(response({data:{ok:true}},200,'"third"'));};
  c.commit(db=>db.contacts[0].brokerage='First edit');const first=c.flushDb();c.commit(db=>db.contacts[0].phone='Second edit');await c.flushDb();assert.equal(calls.length,1);
  resolveFirst(response({data:{ok:true}},200,'"second"'));await first;await settle();assert.equal(calls.length,2);assert.equal(calls[1].headers['If-Match'],'"second"');assert.match(calls[1].body,/Second edit/);assert.equal(c._savedEpoch,2);assert.equal(c.state.saveStatus,'saved');
});

test('revision conflict freezes edits until an explicit reload',async()=>{
  const {c,reloads}=fixture();c.apiFetch=async()=>response({error:'A newer workspace revision exists.'},409);
  c.commit(db=>db.contacts[0].brokerage='Unsaved edit');await c.flushDb();assert.equal(c.state.saveConflict,true);assert.equal(c.state.saveStatus,'error');const epoch=c._saveEpoch;c.commit(db=>db.contacts=[]);assert.equal(c._saveEpoch,epoch);assert.equal(c.state.db.contacts.length,1);c.retrySave();assert.equal(reloads(),1);
});

test('failed saves remain dirty and can be retried without losing the edit',async()=>{
  const {c}=fixture();let calls=0;c.apiFetch=async()=>{calls++;return calls===1?response({error:'Temporary write failure'},503):response({data:{ok:true}},200,'"retry"');};
  c.commit(db=>db.contacts[0].brokerage='Keep this edit');await c.flushDb();assert.equal(c._savedEpoch,0);assert.equal(c.state.saveStatus,'error');assert.equal(c.state.db.contacts[0].brokerage,'Keep this edit');c.retrySave();await settle();assert.equal(calls,2);assert.equal(c._savedEpoch,1);assert.equal(c.state.saveStatus,'saved');
});

test('canonical staff save includes server-created successor tasks',async()=>{
  const {c}=fixture({staff:true});c.state.db.todos=[{id:'w1',status:'Open'}];const snapshot=structuredClone(c.state.db);snapshot.todos=[{id:'w1',status:'Done'},{id:'w2',status:'Open',title:'Server-created next step'}];c.apiFetch=async()=>response({data:{ok:true},snapshot},200,'"staff-next"');c.commit(db=>db.todos[0].status='Done');await c.flushDb();assert.equal(c.state.db.todos.length,2);assert.equal(c.state.db.todos[1].title,'Server-created next step');
});

test('before-unload warns while changes are dirty and clears after saving',async()=>{
  const {c,listeners}=fixture();let warned=false;c.apiFetch=async path=>path==='/api/db'?response({data:c.state.db}):response(c.state.accessUser);c.zoomFetchPhoneMapping=()=>{};c.zoomEnsureEmbed=()=>{};c.zoomFetchCallsList=()=>{};c.zohoFetchStatus=()=>{};
  await c.componentDidMount();c.commit(db=>db.contacts[0].brokerage='Unsent edit');const event={preventDefault(){warned=true;},returnValue:null};listeners.get('beforeunload')(event);assert.equal(warned,true);assert.equal(event.returnValue,'');
  c.apiFetch=async()=>response({data:{ok:true}});await c.flushDb();warned=false;listeners.get('beforeunload')({preventDefault(){warned=true;}});assert.equal(warned,false);
});

test('failed initial load never seeds demo users or lets scheduled work overwrite storage',async()=>{
  const {c,user,intervals,timers}=fixture();c.state={...c.state,db:null,accessUser:null,authChecked:false};let writes=0;c.apiFetch=async(path,options)=>{if(options?.method==='PUT'){writes++;return response({});}return path==='/api/me'?response(user):response({error:'Read unavailable'},503);};
  c.zoomFetchPhoneMapping=()=>{throw Error('A failed workspace must not start integrations.');};c.zoomEnsureEmbed=c.zoomFetchPhoneMapping;c.zoomFetchCallsList=c.zoomFetchPhoneMapping;c.zohoFetchStatus=c.zoomFetchPhoneMapping;
  await c.componentDidMount();assert.equal(c.state.dbLoadFailed,true);assert.equal(c.state.db.users.length,0);assert.equal(c.state.db.sop_templates.length,0);for(const timer of timers.filter(t=>t.delay===900))timer.fn();for(const interval of intervals.filter(t=>t.delay===60000))interval.fn();await c.flushDb();assert.equal(writes,0);
});

test('access changes clear the old view before reloading permission state',async()=>{
  const {c,reloads}=fixture({staff:true});c.apiFetch=async()=>response({...c.state.accessUser,visibility:{sections:[],editSections:[]}});c.state.drawerId='c1';c.state.gq='private';await c.refreshAccess();assert.equal(c.state.db,null);assert.equal(c.state.accessUser,null);assert.equal(c.state.drawerId,null);assert.equal(c.state.gq,'');assert.equal(reloads(),1);
});

test('disabling the signed-in account clears cached records on the next access check',async()=>{
  const {c}=fixture({staff:true});c.apiFetch=async()=>response({error:'No active CRM account found.'},403);c.state.drawerId='c1';c.state.gq='cached';await c.refreshAccess();assert.equal(c.state.db,null);assert.equal(c.state.accessUser,null);assert.equal(c.state.drawerId,null);assert.equal(c.state.gq,'');assert.equal(c.workspaceReady(),false);
});

test('an in-flight save cannot restore cached records after access revocation',async()=>{
  const {c}=fixture({staff:true});let completeSave;c.apiFetch=(path,options)=>options?.method==='PUT'?new Promise(resolve=>{completeSave=resolve;}):Promise.resolve(response({error:'Account disabled.'},403));c.commit(db=>db.contacts[0].brokerage='Pending edit');const saving=c.flushDb();await c.refreshAccess();const snapshot=structuredClone(c.normalizeScopedWorkspace({contacts:[{id:'private',name:'Must stay cleared'}]}));completeSave(response({data:{ok:true},snapshot}));await saving;assert.equal(c.state.db,null);assert.equal(c.state.accessUser,null);assert.equal(c._saveInFlight,false);
});

test('users with no allowed sections receive an empty restricted workspace',async()=>{
  const {c,user}=fixture({staff:true});user.visibility={sections:[],editSections:[]};c.state.authChecked=false;c.state.accessUser=null;const db=c.state.db;c.apiFetch=async path=>path==='/api/db'?response({data:db}):response(user);await c.componentDidMount();assert.equal(c.state.view,'restricted');const values=c.renderVals();assert.equal(values.navGroups.length,0);for(const flag of ['vToday','vCal','vMeet','vClients','vContacts','vWork','vTickets','vSocial','vSops','vActivity','vPipe','vAudits','vUsers','vSettings'])assert.equal(!!values[flag],false,flag);
});

test('loading and unresolved identities do not display Ibrar as the signed-in person',()=>{
  const {c}=fixture();c.state.db=null;c.state.meId=null;c.state.accessUser=null;c.state.authChecked=false;assert.equal(c.me().name,'Your workspace');assert.equal(c.canView('users'),false);assert.equal(c.renderVals().navGroups.length,0);
});

test('embedded frames accept resize and dirty messages only from their actual same-origin window',async()=>{
  const {c,frames,listeners}=fixture();c.apiFetch=async path=>path==='/api/db'?response({data:c.state.db}):response(c.state.accessUser);c.zoomFetchPhoneMapping=()=>{};c.zoomEnsureEmbed=()=>{};c.zoomFetchCallsList=()=>{};c.zohoFetchStatus=()=>{};await c.componentDidMount();const frame={src:'https://crm.sereneop.com/users.html?embedded=1',contentWindow:{},style:{}};frames.push(frame);const receive=listeners.get('message');
  receive({origin:'https://crm.sereneop.com',source:{},data:{type:'serene-embedded-state',height:900,dirty:true}});assert.equal(frame.style.height,undefined);assert.equal(c._embeddedDirty,undefined);
  receive({origin:'https://other.example',source:frame.contentWindow,data:{type:'serene-embedded-state',height:900,dirty:true}});assert.equal(frame.style.height,undefined);
  receive({origin:'https://crm.sereneop.com',source:frame.contentWindow,data:{type:'serene-embedded-state',height:800.8,dirty:true}});assert.equal(frame.style.height,'801px');assert.equal(c._embeddedDirty,true);
  receive({origin:'https://crm.sereneop.com',source:frame.contentWindow,data:{type:'serene-embedded-state',height:90000,dirty:false}});assert.equal(frame.style.height,'32000px');assert.equal(c._embeddedDirty,false);
  receive({origin:'https://crm.sereneop.com',source:frame.contentWindow,data:{type:'serene-embedded-state',height:NaN}});assert.equal(frame.style.height,'32000px');
});

test('unsaved embedded forms protect navigation and browser closing',async()=>{
  const {c,context,listeners}=fixture();c.apiFetch=async path=>path==='/api/db'?response({data:c.state.db}):response(c.state.accessUser);c.zoomFetchPhoneMapping=()=>{};c.zoomEnsureEmbed=()=>{};c.zoomFetchCallsList=()=>{};c.zohoFetchStatus=()=>{};await c.componentDidMount();c.state.view='users';c._embeddedDirty=true;context.confirm=()=>false;c.go('contacts');assert.equal(c.state.view,'users');assert.equal(c._embeddedDirty,true);c.openContact('c1');assert.equal(c.state.view,'users');let warned=false;listeners.get('beforeunload')({preventDefault(){warned=true;}});assert.equal(warned,true);context.confirm=()=>true;c.go('contacts');assert.equal(c.state.view,'contacts');assert.equal(c._embeddedDirty,false);
});

test('iframe URLs request the compact embedded layout and retain the selected contact',()=>{
  const {c}=fixture();c.state.auditContactId='c1&x';const values=c.renderVals();assert.equal(values.usersFrameUrl,'/users.html?embedded=1');assert.equal(values.auditFrameUrl,'/audits.html?embedded=1&contact=c1%26x');
});

test('all native views produce a render model on an empty operational workspace',()=>{
  const {c}=fixture();c.state.db=c.ensureEnhancements(c.state.db);c.state.contactId='c1';for(const view of ['today','calendar','inbox','meetings','dashboard','pipeline','calls','contacts','audits','clients','work','tickets','social','sops','automations','activity','reports','users','settings','contact']){c.state.view=view;assert.doesNotThrow(()=>c.renderVals(),view);}
});
