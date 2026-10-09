import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {scopeSnapshot} from './user-access.mjs';
const require=createRequire(import.meta.url);
const {refineAssignedViews}=require('./refine-assigned-views.cjs');
const {fixOwnerContactPlaceholder}=require('./fix-owner-contact-placeholder.cjs');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const original=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const template=fixOwnerContactPlaceholder(refineAssignedViews(original));
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture(sections,editSections=[],owner=false){
  const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    location:{hostname:'crm.sereneop.com',origin:'https://crm.sereneop.com'},document:{querySelectorAll:()=>[]},
    window:{scrollTo(){},addEventListener(){},removeEventListener(){},location:{reload(){}}},
    DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
  vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);
  const c=new context.ReviewComponent();c.props={};c.toast=message=>{c.lastToast=message;};let saves=0;c.persistDb=()=>{saves++;};
  const user={id:owner?'u_ibrar':'u_zayna',orgId:'org1',name:owner?'Ibrar Ul Islam':'Zayna Azem',email:owner?'ibrar@example.test':'zayna@example.test',isOwner:owner,visibility:{sections,editSections}};
  const full=c.ensureEnhancements({org:{id:'org1',name:'Serene Ops',capacity_hours:230,trigger:.75},
    users:[{id:'u1',auth_user_id:'u_ibrar',name:'Ibrar Ul Islam',email:'ibrar@example.test',role:'Owner / Admin'},{id:'u2',auth_user_id:'u_zayna',name:'Zayna Azem',email:'zayna@example.test',role:'Contributor'}],
    contacts:[{id:'c1',name:'Assigned Realtor',owner:'Zayna Azem',status:'Client',state:'NY',timezone:'America/New_York',services:['03'],monthly_override:90000,email:'assigned@example.test',phone:'+15550001111',brokerage:'Assigned Brokerage'},{id:'c2',name:'Other Realtor Secret',owner:'Ibrar Ul Islam',status:'Client',state:'CA',timezone:'America/Los_Angeles',services:['01']}],
    todos:[{id:'w1',contact_id:'c1',title:'Assigned CRM cleanup',status:'Open',op_status:'Not Started',module:'03',source:'Requested',assignee:'Zayna Azem',due_at:'2026-10-07T14:00:00.000Z',due_tz:'America/New_York',time_logs:[],ticket_id:'t1'},{id:'w2',contact_id:'c2',title:'Other work secret',status:'Open',module:'01',assignee:'Ibrar Ul Islam',due_at:'2026-10-08T14:00:00.000Z',time_logs:[]}],
    tickets:[{id:'t1',contact_id:'c1',title:'Assigned review',type:'Question',status:'Assigned',module:'03',assignee:'Zayna Azem',zoho_message_id:'private-mail-id',raised_at:'2026-10-06T14:00:00.000Z'},{id:'t2',contact_id:'c2',title:'Other ticket secret',status:'Assigned',module:'01',assignee:'Ibrar Ul Islam'}],
    meetings:[{id:'m1',contact_id:'c1',kind:'Assigned meeting',assignee:'Zayna Azem',at:'2026-10-07T14:00:00.000Z',timezone:'America/New_York',summary_status:'available',summary_text:'Assigned meeting summary'},{id:'m2',contact_id:'c2',kind:'Other meeting secret',assignee:'Ibrar Ul Islam',at:'2026-10-08T14:00:00.000Z'}],
    reminders:[{id:'r1',contact_id:'c1',title:'Assigned reminder',kind:'Email',assignee:'Zayna Azem',at:'2026-10-07T15:00:00.000Z',timezone:'America/New_York',done:false}],
    social_posts:[{id:'sp1',contact_id:'c1',title:'Draft review',platform:'Instagram',format:'Reel',status:'Waiting approval',approval_required:true,assignee:'Zayna Azem',scheduled_at:'2026-10-08T14:00:00.000Z'},{id:'sp2',contact_id:'c1',title:'Approved post',platform:'Instagram',format:'Reel',status:'Approved',approval_required:true,assignee:'Zayna Azem',scheduled_at:'2026-10-08T14:00:00.000Z'}],
    deals:[],checklists:{precall:[],onboarding:[]}});
  c.state={...c.state,authChecked:true,accessUser:user,dbLoadFailed:false,meIdUnresolved:false,meId:owner?'u1':'u2',db:c.normalizeScopedWorkspace(scopeSnapshot(full,user)),now:Date.parse('2026-10-07T12:00:00.000Z'),view:sections[0]||'restricted'};
  return {c,user,full,saves:()=>saves};
}
function conditionsAt(marker){const at=template.indexOf(marker);assert.ok(at>=0,marker);const stack=[];for(const m of template.slice(0,at).matchAll(/<\/?sc-if\b[^>]*>/g)){if(m[0].startsWith('</'))stack.pop();else stack.push(m[0]);}return stack.join(' ');}

test('work-only staff get their task and minimal context, with no contact, calendar or dialer controls',()=>{
  const {c}=fixture(['work'],['work']);const values=c.renderVals();
  assert.deepEqual(plain(values.navGroups.flatMap(g=>g.items.map(i=>i.label))),['Work']);
  assert.equal(c.state.db.todos.length,1);assert.equal(values.canShowCalendar,false);assert.equal(values.canShowActivity,false);assert.equal(values.canManageRecords,false);assert.equal(values.dialerOpen,false);assert.equal(values.searchPlaceholder,'Search your workspace');
  const row=values.workGroups[0].items[0];assert.equal(row.title,'Assigned CRM cleanup');assert.equal(row.client,'Assigned record');assert.doesNotMatch(row.meta,/ticket/);assert.ok(!values.groupOpts.some(o=>o.label==='By client'));
  row.openDrawer();assert.ok(!c.state.drawerId);values.toggleDialer();assert.ok(!c.state.dialerOpen);
  assert.match(conditionsAt('sc-camel-on-click="{{ toggleDialer }}"'),/canManageRecords/);
  assert.match(conditionsAt('class="crm-upcoming-strip"'),/commandShowUpcoming/);assert.equal(values.commandShowUpcoming,false);
});

test('clients-only staff can open assigned details without commercial or removed workflow traces',()=>{
  const {c}=fixture(['clients']);const values=c.renderVals();assert.equal(values.clientCards.length,1);assert.equal(values.clientCards[0].value,'');assert.doesNotMatch(values.clientsSummary,/\$|recurring/);assert.equal(values.clientTimeColumns,'1fr');assert.equal(values.canShowClientSide,false);assert.equal(values.canShowDelivery,false);
  values.clientCards[0].go();const detail=c.renderVals();assert.equal(c.state.view,'contact');assert.equal(detail.cd.tDetails,true);assert.deepEqual(plain(detail.cd.tabs.map(t=>t.label)),['Details','Documents']);
  assert.ok(!detail.cd.glance.some(g=>['Monthly','Notice','Deal stage','Open work','Hours logged','Open tickets','Reminders','Last touch'].includes(g.k)));
  assert.match(conditionsAt('{{ cd.moduleTotal }}'),/canManageRecords/);assert.match(conditionsAt('{{ cd.meetings }}'),/canShowMeetings/);assert.match(conditionsAt('{{ c.stateStyle }}'),/canShowDelivery/);
  c.openDrawer('c1');const drawer=c.renderVals();assert.deepEqual(plain(drawer.dw.glance.map(g=>g.k)),['Owner']);drawer.dw.onPhone({target:{value:'changed'}});assert.equal(c.state.db.contacts[0].phone,'+15550001111');
});

test('calendar permission alone shows reminders, with no task or meeting legend',()=>{
  const {c}=fixture(['calendar']);const values=c.renderVals();assert.equal(c.state.db.todos.length,0);assert.equal(c.state.db.meetings.length,0);assert.deepEqual(plain(values.calKindOpts),['All','Calls / reminders']);assert.deepEqual(plain(values.calKeys.map(k=>k.label)),['Calls','Reminders']);assert.equal(values.canShowMeetings,false);assert.equal(values.canShowWork,false);
});

test('today without work renders My day and hides work and calendar widgets',()=>{
  const {c}=fixture(['today']);const values=c.renderVals();assert.equal(values.viewTitle,'My day');assert.equal(values.canShowWork,false);assert.equal(values.canShowCalendar,false);assert.equal(values.canShowDailyMeetings,false);assert.equal(values.tWork.length,0);assert.equal(values.navGroups[0].items[0].label,'My day');
});

test('no sections yields a restricted workspace and no removed-section navigation',()=>{
  const {c}=fixture([]);const values=c.renderVals();assert.equal(values.noSections,true);assert.equal(values.navGroups.length,0);assert.equal(values.canShowWork,false);assert.equal(values.canShowCalendar,false);assert.equal(values.canShowActivity,false);assert.equal(values.dialerOpen,false);assert.equal(c.state.db.contacts.length,0);assert.equal(c.state.db.todos.length,0);
});

test('read-only assigned work offers no timer or completion mutation',()=>{
  const {c,saves}=fixture(['work']);const row=c.renderVals().workGroups[0].items[0];assert.equal(row.canUpdate,false);assert.equal(row.readOnly,true);row.start();row.complete();row.onOp({target:{value:'Complete'}});assert.equal(c.state.db.todos[0].status,'Open');assert.equal(c.state.db.todos[0].time_logs.length,0);assert.equal(saves(),0);
});

test('staff publish only approved posts and cannot grant social approval through the grid',()=>{
  const {c}=fixture(['social'],['social']);const rows=c.renderVals().socialRows;assert.equal(rows[0].publishDisabled,true);assert.equal(rows[0].action,'Awaiting approval');assert.equal(rows[1].publishDisabled,false);rows[0].publish();assert.equal(c.state.db.social_posts[0].status,'Waiting approval');assert.match(c.lastToast,/approve/);rows[1].publish();assert.equal(c.state.db.social_posts[1].status,'Published');
  const read=fixture(['social']).c.renderVals().socialRows;assert.ok(read.every(r=>r.publishDisabled));assert.ok(read.every(r=>r.action==='Read-only'));
});

test('legacy assigned approval tasks have read-only controls and refuse all completion paths',()=>{
  const {c,saves}=fixture(['work','sops','social'],['work','social']);c.state.view='work';const db=c.state.db;
  db.sop_instances.push({id:'i1',status:'Active',template_snapshot:{steps:[{id:'s1',approval:true}]}});db.todos[0].sop_instance_id='i1';db.todos[0].sop_step_id='s1';
  const row=c.renderVals().workGroups[0].items[0];assert.equal(row.canUpdate,false);assert.equal(row.readOnly,true);row.start();row.complete();c.setOp('w1','Complete');c.endTaskTimer('w1',true);assert.equal(db.todos[0].status,'Open');assert.equal(saves(),0);assert.match(c.lastToast,/Only Ibrar/);
  delete db.todos[0].sop_instance_id;db.todos[0].social_post_id='sp1';db.todos[0].title='Approve Instagram caption';assert.equal(c.staffApprovalTask(db.todos[0]),true);
});

test('user ID and email assignments remain visible in Mine, by-person, Today and Social views',()=>{
  const {c,user,full}=fixture(['today','work','social'],['work','social']);full.todos[0].assignee='legacy display name';full.todos[0].assignee_user_id=user.id;full.social_posts[0].assignee=user.email;full.social_posts[1].assignee=user.id;
  c.state.db=c.normalizeScopedWorkspace(scopeSnapshot(full,user));c.state.wScope='mine';c.state.wGroup='owner';c.state.view='work';let values=c.renderVals();assert.equal(values.workGroups[0].items[0].title,'Assigned CRM cleanup');
  c.state.view='today';values=c.renderVals();assert.equal(values.tWork.length,1);c.state.view='social';values=c.renderVals();assert.equal(values.socialRows.length,2);
});

test('Ibrar retains full client commercial details, source legends and management controls',()=>{
  const {c}=fixture(['clients'],[],true);const values=c.renderVals();assert.equal(values.clientCards.length,2);assert.match(values.clientCards[0].value,/90,000/);assert.equal(values.canManageRecords,true);assert.equal(values.canShowClientSide,true);assert.equal(values.searchPlaceholder,'Search everything');c.state.view='calendar';assert.deepEqual(plain(c.renderVals().calKeys.map(k=>k.label)),['Meetings','Tasks','Calls','Reminders']);
});

test('owner contact rows retain a dash for non-clients while staff have no Monthly column',()=>{
  const {c}=fixture(['contacts'],[],true);c.state.db.contacts[0].status='Contacted';c.state.view='contacts';let values=c.renderVals();assert.equal(values.contactRows.find(r=>r.name==='Assigned Realtor').value,'—');assert.ok(values.contactCols.includes('Monthly'));
  const staff=fixture(['contacts']).c;values=staff.renderVals();assert.equal(values.contactRows[0].value,'');assert.ok(!values.contactCols.includes('Monthly'));
});

test('real bundled sc-for/sc-if functions preserve owner root flags and evaluate row permissions',()=>{
  const manifest=JSON.parse(html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/)[1]),entry=manifest['a7d463f2-4e00-4aa4-83bf-f6394318e018'];
  const runtime=(entry.compressed?zlib.gunzipSync(Buffer.from(entry.data,'base64')):Buffer.from(entry.data,'base64')).toString('utf8');
  const extract=name=>{const start=runtime.indexOf('  function '+name+'('),end=runtime.indexOf('\n  }\n',start);assert.ok(start>=0&&end>start,name);return runtime.slice(start,end+5);};
  const context={console,Array,String,Number,Set,h:(tag,props,...children)=>({tag,props,children}),getReact:()=>({Fragment:'fragment'}),walkChildren:el=>el.builders,warnUnresolved:()=>{throw Error('Unexpected unresolved template value');}};
  vm.createContext(context);vm.runInContext(runtime.match(/  var IDENT_RE = [^\n]+/)[0]+'\n'+runtime.match(/  var NUMBER_RE = [^\n]+/)[0]+'\n'+['resolve','parensWrapWhole','findTopLevelEquality','resolvePath','compileAttr','walkFor','walkIf'].map(extract).join('\n'),context);
  const element=(attributes,builders)=>({getAttribute:name=>attributes[name]??null,builders});
  const ownerCell=context.walkIf(element({value:'{{ canManageRecords }}'},[vals=>vals.c.value]),{});
  const loop=context.walkFor(element({list:'{{ contactRows }}',as:'c'},[ownerCell]),{});
  assert.match(JSON.stringify(loop({canManageRecords:true,contactRows:[{value:'—'}]},{})),/—/);
  assert.doesNotMatch(JSON.stringify(loop({canManageRecords:false,contactRows:[{value:'hidden'}]},{})),/hidden/);
  const rowAction=context.walkIf(element({value:'{{ w.canUpdate }}'},[()=> 'completion action']),{}),rows=context.walkFor(element({list:'{{ work }}',as:'w'},[rowAction]),{});
  assert.doesNotMatch(JSON.stringify(rows({canUpdateWork:true,work:[{canUpdate:false}]},{})),/completion action/);
  assert.match(JSON.stringify(rows({canUpdateWork:true,work:[{canUpdate:true}]},{})),/completion action/);
});

test('assigned-view patch compiles, is repeat-safe and preserves markup nesting',()=>{
  assert.equal(refineAssignedViews(template),template);assert.doesNotThrow(()=>new vm.Script(code));const markup=template.slice(0,template.indexOf('<script type="text/x-dc"'));
  for(const tag of ['div','sc-if']){let depth=0;for(const m of markup.matchAll(new RegExp('<\\/?'+tag+'\\b[^>]*>','g'))){depth+=m[0].startsWith('</')?-1:1;assert.ok(depth>=0,tag);}assert.equal(depth,0,tag);}
});
