import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {fixNativeWorkflowTemplate}=require('./fix-native-workflows.cjs');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const rawTemplate=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const template=fixNativeWorkflowTemplate(rawTemplate);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];

function fixture({staff=false,sections=['contacts','clients','work','tickets','calendar','social'],editSections=['work','tickets','social']}={}){
  const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
  vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);
  const c=new context.ReviewComponent();c.props={};c.persistDb=()=>{};c.toast=message=>{c.lastToast=message;};c.state.authChecked=true;
  c.state.accessUser={isOwner:!staff,email:staff?'zayna@example.com':'ibrar@example.com',visibility:{sections,editSections}};
  const db={org:{id:'org1',capacity_hours:230,trigger:.75},users:[{id:'u1',name:staff?'Zayna Azem':'Ibrar Ul Islam',email:c.state.accessUser.email}],contacts:[{id:'c1',name:'Fictional native QA',state:'NY',timezone:'America/New_York',status:'Not contacted',services:[]}],todos:[],tickets:[],deals:[{id:'d1',contact_id:'c1',stage:'Demo scheduled',scope_agreed:'',checks:{}}],checklists:{precall:[],onboarding:[]}};
  c.state.db=c.ensureEnhancements(db);c.state.meId='u1';
  c.x=()=>({db:c.state.db,live:c.state.db.contacts,clients:[],byId:{c1:c.state.db.contacts[0]},wStart:9,wEnd:17});return c;
}

test('manual meeting uses the selected audience zone, not the computer zone',()=>{
  const c=fixture();const timezone=c.calendarTZOptions().find(z=>z.tz==='America/New_York').label;
  c.state.modal='newmeeting';c.state.draft={contact:'Fictional native QA',kind:'Demo',date:'2026-10-07',time:'10:00',timezone,minutes:'30'};
  c.saveModal(c.x());assert.equal(c.state.db.meetings[0].at,'2026-10-07T14:00:00.000Z');assert.equal(c.state.db.meetings[0].timezone,'America/New_York');
});

test('scheduling rejects impossible dates, invalid times and the spring DST gap',()=>{
  const c=fixture();assert.equal(c.dateTimeToUtc('2026-02-31','10:00','UTC'),null);assert.equal(c.dateTimeToUtc('2026-10-07','25:10','UTC'),null);assert.equal(c.dateTimeToUtc('2026-03-08','02:30','America/New_York'),null);assert.equal(c.dateTimeToUtc('2026-10-07','00:00','America/New_York'),'2026-10-07T04:00:00.000Z');
});

test('bulk deal moves apply the written scope and acceptance gates atomically',()=>{
  const c=fixture();c.state.modal='bulkdealstage';c.state.draft={ids:['d1'],stage:'Closed won'};c.saveModal(c.x());
  assert.equal(c.state.db.deals[0].stage,'Demo scheduled');assert.match(c.state.err,/written scope/);
  c.state.db.deals[0].scope_agreed='Fictional agreed scope';c.saveModal(c.x());assert.equal(c.state.db.deals[0].stage,'Demo scheduled');assert.match(c.state.err,/acceptance/);
  c.state.db.sop_instances.push({id:'i1',template_id:'sop_acceptance',contact_id:'c1',status:'Complete'});c.saveModal(c.x());
  assert.equal(c.state.db.deals[0].stage,'Closed won');assert.equal(c.state.db.contacts[0].status,'Client');assert.ok(c.state.db.deals[0].stage_at);assert.ok(c.state.db.sop_instances.some(i=>i.template_id==='sop_onboarding'));
});

test('new deals cannot bypass scope and acceptance gates',()=>{
  const c=fixture();c.state.modal='newdeal';c.state.draft={contact:'Fictional native QA',stage:'Closed won'};c.saveModal(c.x());assert.equal(c.state.db.deals.length,1);assert.match(c.state.err,/earlier stage/);
});

test('checkbox and timer completion both enforce evidence-required steps',()=>{
  const c=fixture();c.state.db.todos.push({id:'w1',contact_id:'c1',title:'Evidence review',module:'01',source:'SOP',status:'Open',op_status:'Needs Review',evidence_required:true,time_logs:[],minutes:0,due_at:'2026-10-07T14:00:00.000Z'});
  c.toggleTodo('w1');assert.equal(c.state.db.todos[0].status,'Open');assert.equal(c.state.modal,'complete');
  c.endTaskTimer('w1',true);assert.equal(c.state.db.todos[0].status,'Open');
  c.state.modal='complete';c.state.draft={id:'w1',body:'Approval recorded in the reviewed file.'};c.saveModal(c.x());assert.equal(c.state.db.todos[0].status,'Done');assert.match(c.state.db.todos[0].completion_note,/Approval/);
  const row=c.workRow(c.state.db.todos[0],c.x());assert.equal(typeof row.complete,'function');row.complete();assert.equal(c.state.db.todos[0].status,'Open');
});

test('staff cannot create, archive, reschedule or update a read-only section',()=>{
  const c=fixture({staff:true,editSections:[]});c.state.db.todos.push({id:'w1',contact_id:'c1',title:'Assigned QA task',status:'Open',op_status:'Not Started',time_logs:[],due_at:'2026-10-07T14:00:00.000Z'});
  c.openQuickForRole();assert.equal(c.state.modal,null);c.openNewWork(c.x());assert.equal(c.state.modal,null);
  c.startTaskTimer('w1');c.endTaskTimer('w1',true);assert.equal(c.state.db.todos[0].status,'Open');assert.equal(c.state.db.todos[0].time_logs.length,0);
  c.archiveOne('todos','w1','work');assert.equal(c.state.db.todos.length,1);c.dropCalendarDate({preventDefault(){},dataTransfer:{getData:()=> 'cal|todos|w1'}},'2026-10-08','UTC');assert.equal(c.state.db.todos[0].due_at,'2026-10-07T14:00:00.000Z');
});

test('staff task completion submits only the authorized task edit for server progression',()=>{
  const c=fixture({staff:true});c.state.db.todos.push({id:'w1',contact_id:'c1',title:'Assigned recurring SOP',module:'01',source:'SOP',status:'Open',op_status:'Not Started',sop_instance_id:'i1',sop_step_id:'s1',due_at:'2026-10-07T14:00:00.000Z',due_tz:'America/New_York',time_logs:[],recurrence:{repeat:'Weekly',interval:1,series_id:'r1',endType:'Never ends'}});c.state.db.sop_instances.push({id:'i1',template_id:'test',contact_id:'c1',status:'Active',completed:{},template_snapshot:{steps:[{id:'s1',title:'First step'},{id:'s2',title:'Second step'}]}});
  c.endTaskTimer('w1',true);assert.equal(c.state.db.todos[0].status,'Done');assert.equal(c.state.db.todos.length,1);assert.deepEqual(Object.keys(c.state.db.sop_instances[0].completed),[]);
});

test('cancelled tasks cannot start timers or complete without reopening',()=>{
  const c=fixture();c.state.db.todos.push({id:'w1',contact_id:'c1',title:'Cancelled task',status:'Cancelled',op_status:'Cancelled',time_logs:[],due_at:'2026-10-07T14:00:00.000Z'});c.startTaskTimer('w1');assert.equal(c.state.db.todos[0].time_logs.length,0);assert.equal(c.state.db.todos[0].op_status,'Cancelled');c.endTaskTimer('w1',true);assert.equal(c.state.db.todos[0].status,'Cancelled');
});

test('completed SOP steps can reopen only through workflow rollback controls',()=>{
  const c=fixture();c.state.db.todos.push({id:'w1',contact_id:'c1',title:'Done SOP step',status:'Done',op_status:'Complete',sop_instance_id:'i1',sop_step_id:'s1',time_logs:[],due_at:'2026-10-07T14:00:00.000Z'});c.toggleTodo('w1');assert.equal(c.state.db.todos[0].status,'Done');assert.match(c.lastToast,/rollback/);c.setOp('w1','Not Started');assert.equal(c.state.db.todos[0].status,'Done');
  c.state.modal='edittask';c.state.draft={id:'w1',title:'Done SOP step',status:'Open'};c.saveModal(c.x());assert.equal(c.state.db.todos[0].status,'Done');assert.match(c.state.err,/rollback/);
});

test('staff contact tabs and navigation respect removed sections',()=>{
  const c=fixture({staff:true,sections:['today','tickets'],editSections:['tickets']});c.openContact('c1');c.openDrawer('c1');c.openMeeting('m1');assert.equal(c.state.view,'today');assert.equal(c.state.drawerId,undefined);assert.equal(c.state.meetOpen,undefined);
  assert.equal(c.contactTabVisible('work'),false);assert.equal(c.contactTabVisible('tickets'),true);assert.equal(c.contactTabVisible('deals'),false);assert.equal(c.contactTabVisible('access'),false);assert.equal(c.contactTabVisible('notes'),false);
});

test('workflow patch is repeat-safe and native script compiles',()=>{
  assert.equal(fixNativeWorkflowTemplate(template),template);assert.doesNotThrow(()=>new vm.Script(code));assert.match(template,/canManageRecords/);assert.match(template,/canUpdateWork/);
});
