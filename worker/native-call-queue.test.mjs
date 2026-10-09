import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{integrateCallQueue}=require('./integrate-call-queue.cjs');
const raw=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),template=JSON.parse(raw.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]),code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture({owner=true,sections=['calls'],edits=['calls']}={}){
 const replies=[],links=[],timers=[],requests=[];
 const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,confirm:()=>true,location:{hostname:'crm.sereneop.com',origin:'https://crm.sereneop.com'},document:{querySelectorAll:()=>[],createElement:()=>({style:{},click(){links.push(this.href);}}),body:{appendChild(){},removeChild(){}}},window:{scrollTo(){},addEventListener(){},removeEventListener(){},location:{reload(){}}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return 1;},clearTimeout(){},setInterval:()=>1,clearInterval(){},DCLogic:class{setState(next,cb){this.state={...this.state,...(typeof next==='function'?next(this.state):next)};cb?.();}}};
 vm.createContext(context);vm.runInContext(code+';globalThis.CallingComponent=Component;',context);
 const c=new context.CallingComponent();c.props={};c.toast=()=>{};
 const user={id:owner?'u_ibrar':'u_staff',email:'qa@example.test',name:'Fictional QA Caller',isOwner:owner,visibility:{sections,editSections:edits}};
 const db=c.normalizeScopedWorkspace({org:{id:'org1',capacity_hours:100,trigger:.75},users:[{id:user.id,email:user.email,name:user.name,role:owner?'Owner / Admin':'Contributor'}],contacts:[],checklists:{precall:[],onboarding:[]}});
 c.state={...c.state,db,accessUser:user,authChecked:true,dbLoadFailed:false,meIdUnresolved:false,meId:user.id,view:'callqueue',now:Date.now()};c._saveEpoch=0;c._savedEpoch=0;
 const reply=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
 c.apiFetch=async(path,input)=>{requests.push({path,input});if(path==='/api/call-queue/check')return reply({eligible:true,contact:{contactId:'c1',phone:'+15550001111',closesAt:new Date(Date.now()+3600000).toISOString()},idempotencyKey:'checked-attempt',checkedAt:new Date().toISOString()});if(path==='/api/zoom/phone-mapping')return reply({data:{zoom_user_id:'authorized-phone'}});if(path==='/api/zoom/calls/claim')return reply({data:{ok:true,closesAt:new Date(Date.now()+3600000).toISOString()}});throw Error('Unexpected endpoint '+path);};
 const frame={contentWindow:{postMessage:(value,origin)=>replies.push({value,origin})}};
 return {c,user,frame,replies,links,timers,requests,reply,context};
}
test('replacement opens a live calling list instead of capturing a stale client array',()=>{
 const {c}=fixture();const card=c.callVals({db:c.state.db,byId:{}}).queues.find(x=>x.name==='Next to call');assert.ok(card);assert.equal(card.label,'Open call list');assert.equal(card.has,true);assert.ok(!c.QUEUE_RULES.some(x=>x.k==='callable_clients'));card.go();assert.equal(c.state.view,'callqueue');assert.equal(c.renderVals().vCallQueue,true);assert.equal(integrateCallQueue(template),template);
});
test('Calls-only staff see assigned calling list without administrator queues or contact traces',()=>{
 const {c}=fixture({owner:false});c.go('calls');const values=c.renderVals();assert.equal(c.state.view,'callqueue');assert.equal(values.vCallQueue,true);assert.equal(values.vCalls,false);assert.equal(values.canShowContacts,false);assert.deepEqual(plain(values.navGroups.flatMap(g=>g.items.map(x=>x.label))),['Assigned calling list']);assert.ok(!values.queues);assert.equal(values.dialerOpen,false);
});
test('removing Calls removes list navigation and blocks direct view and dispatch',async()=>{
 const {c,frame,links,requests,replies}=fixture({owner:false,sections:['work'],edits:['work']});c.go('callqueue');assert.equal(c.canView('callqueue'),false);assert.equal(c.renderVals().vCallQueue,false);assert.ok(!c.renderVals().navGroups.flatMap(g=>g.items).some(x=>x.id==='calls'));await c.dispatchCallQueue({requestId:'r1',contactId:'c1'},frame);assert.equal(requests.length,0);assert.equal(links.length,0);assert.equal(replies[0].value.ok,false);
});
test('read-only calling permission cannot prepare or launch a phone call',async()=>{
 const {c,frame,replies,requests,links}=fixture({owner:false,edits:[]});assert.equal(c.renderVals().vCallQueue,true);await c.dispatchCallQueue({requestId:'r1',contactId:'c1'},frame);assert.equal(requests.length,0);assert.equal(links.length,0);assert.equal(replies[0].value.ok,false);
});
test('dial uses canonical server phone after current eligibility, self mapping and fresh claim',async()=>{
 const {c,frame,replies,requests,links}=fixture({owner:false});await c.dispatchCallQueue({requestId:'r1',contactId:'c1',phone:'+19999999999',inactivityDays:14},frame);assert.deepEqual(requests.map(x=>x.path),['/api/call-queue/check','/api/zoom/phone-mapping','/api/zoom/calls/claim']);assert.equal(JSON.parse(requests[2].input.body).destNumber,'+15550001111');assert.equal(JSON.parse(requests[2].input.body).queueContactId,'c1');assert.equal(JSON.parse(requests[2].input.body).inactivityDays,14);assert.equal(links[0],'zoomphonecall://%2B15550001111');assert.equal(replies[0].value.idempotencyKey,'checked-attempt');assert.equal(replies[0].origin,'https://crm.sereneop.com');assert.equal(c._queueDispatchPending,false);
});
test('missing phone mapping produces setup guidance without a provider call or outcome',async()=>{
 const {c,frame,requests,replies,links,reply}=fixture();const fetch=c.apiFetch;c.apiFetch=(path,input)=>path==='/api/zoom/phone-mapping'?reply({data:null}):fetch(path,input);await c.dispatchCallQueue({requestId:'r1',contactId:'c1'},frame);assert.equal(links.length,0);assert.ok(!requests.some(x=>x.path.includes('/claim')||x.path.includes('/outcome')));assert.match(replies[0].value.error,/Zoom Phone access/);
});

test('canonical formatted numbers are normalized before the desktop phone handoff',async()=>{
 const {c,frame,links,reply}=fixture({owner:false}),fetch=c.apiFetch;c.apiFetch=(path,input)=>path==='/api/call-queue/check'?reply({eligible:true,contact:{contactId:'c1',phone:'+1 (555) 000-1111',closesAt:new Date(Date.now()+3600000).toISOString()},idempotencyKey:'checked-attempt'}):fetch(path,input);await c.dispatchCallQueue({requestId:'r1',contactId:'c1'},frame);assert.deepEqual(links,['zoomphonecall://%2B15550001111']);
});
test('server rejection and a just-closed window prevent phone dispatch',async()=>{
 for(const kind of ['rejected','closed']){const {c,frame,links,replies,reply}=fixture(),fetch=c.apiFetch;c.apiFetch=(path,input)=>path==='/api/zoom/calls/claim'?kind==='rejected'?reply({error:'Calling window closed.'},409):reply({data:{ok:true,closesAt:new Date(Date.now()-1).toISOString()}}):fetch(path,input);await c.dispatchCallQueue({requestId:'r1',contactId:'c1'},frame);assert.equal(links.length,0);assert.equal(replies[0].value.ok,false);assert.match(replies[0].value.error,/window.*closed/i);}
});
test('a permission or screen change while preparing prevents the call',async()=>{
 const {c,frame,links,replies,reply}=fixture({owner:false}),fetch=c.apiFetch;c.apiFetch=async(path,input)=>{if(path==='/api/zoom/phone-mapping'){c.state.accessUser.visibility.editSections=[];return reply({data:{zoom_user_id:'mapped'}});}return fetch(path,input);};await c.dispatchCallQueue({requestId:'r1',contactId:'c1'},frame);assert.equal(links.length,0);assert.equal(replies[0].value.ok,false);
});
test('a second call is blocked while a phone request is already active',async()=>{
 const {c,frame,requests,links,replies}=fixture();c.state.zoomActiveCall={contactId:'prior'};await c.dispatchCallQueue({requestId:'r1',contactId:'c1'},frame);assert.equal(requests.length,0);assert.equal(links.length,0);assert.match(replies[0].value.error,/already in progress/);
});
