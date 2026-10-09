import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import integration from './integrate-autosave-recovery.cjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const original=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const template=integration.transform(original),code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
function fixture(){
 const timers=[],reloads=[];
 const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,location:{hostname:'crm.sereneop.com',origin:'https://crm.sereneop.com'},window:{location:{reload(){reloads.push(true);}}},setTimeout:(fn,delay)=>{const timer={fn,delay,cancelled:false};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;},DCLogic:class{setState(value,cb){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};cb?.();}}};
 vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);const c=new context.ReviewComponent();c.props={};c.toast=()=>{};
 const db={org:{id:'org1'},users:[{id:'u_sales',email:'sales@example.invalid',name:'Sales Person'}],contacts:[{id:'c1',name:'Fictional contact',sales_notes:'Before'}],deals:[],tickets:[],todos:[],checklists:{precall:[],onboarding:[]}};
 c.state={...c.state,db:c.normalizeScopedWorkspace(db),accessUser:{email:'sales@example.invalid',name:'Sales Person',isOwner:false,visibility:{profile:'sales_associate',scope:'all_sales',sections:['contacts'],editSections:['contacts']}},authChecked:true,meId:'u_sales',meIdUnresolved:false,dbLoadFailed:false};c._saveEpoch=0;c._savedEpoch=0;c._snapshotEtag='"before"';return{c,timers,reloads,context};
}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',ETag:'"after"'}});
test('notes save on typing and never turn an HTML200 page into a saved acknowledgement',async()=>{
 assert.match(template,/sc-camel-on-input="\{\{ cd\.onSalesNotes \}\}"/);
 const {c}=fixture();c.apiFetch=async()=>new Response('<!DOCTYPE html><html>Sign in</html>',{headers:{'Content-Type':'text/html'}});c.patch('contacts','c1','sales_notes','Keep my conversation notes');await c.flushDb();assert.equal(c._savedEpoch,0);assert.equal(c.state.db.contacts[0].sales_notes,'Keep my conversation notes');assert.equal(c.state.saveStatus,'error');assert.doesNotMatch(c.state.saveError,/Unexpected token|DOCTYPE/);assert.equal(c.state.saveConflict,false);
});
test('a temporary HTML503 keeps notes pending and retries with the same protected workspace revision',async()=>{
 const {c,timers}=fixture();const requests=[];c.apiFetch=async(path,options)=>{requests.push({path,options});return requests.length===1?new Response('<!DOCTYPE html><html>Unavailable</html>',{status:503,headers:{'Content-Type':'text/html'}}):json({data:{ok:true,updatedAt:'after'}});};c.patch('contacts','c1','sales_notes','Keep my first note');await c.flushDb();assert.equal(c._savedEpoch,0);assert.equal(c.state.saveStatus,'error');const retry=timers.find(timer=>timer.delay===1000);assert.ok(retry);await retry.fn();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);assert.equal(requests[1].options.headers['If-Match'],'"before"');assert.equal(c._savedEpoch,c._saveEpoch);assert.equal(c.state.saveStatus,'saved');
});
test('an expired session preserves the dirty window and does not retry or claim saved',async()=>{
 const {c,timers,context,reloads}=fixture();context.fetch=async()=>new Response('<!DOCTYPE html><html>Access login</html>',{status:401,headers:{'Content-Type':'text/html'}});c.patch('contacts','c1','sales_notes','Keep while signing in');await c.flushDb();assert.equal(reloads.length,0);assert.equal(c._savedEpoch,0);assert.equal(c.state.db.contacts[0].sales_notes,'Keep while signing in');assert.match(c.state.saveError,/sign-in needs to be renewed/);assert.equal(timers.filter(timer=>[1000,3000,8000].includes(timer.delay)).length,0);
});
test('a newer revision during recovery stops retries and keeps the unsaved notes for review',async()=>{
 const {c,timers}=fixture();let requests=0;c.apiFetch=async()=>++requests===1?json({error:'Temporary failure'},503):json({error:'A newer revision exists'},409);c.patch('contacts','c1','sales_notes','My unsaved edit');await c.flushDb();timers.find(timer=>timer.delay===1000).fn();await new Promise(resolve=>setImmediate(resolve));assert.equal(c.state.saveConflict,true);assert.equal(c._savedEpoch,0);assert.equal(c.state.db.contacts[0].sales_notes,'My unsaved edit');assert.equal(timers.filter(timer=>[1000,3000,8000].includes(timer.delay)).length,1);
});
test('a malformed JSON acknowledgement remains dirty rather than reporting success',async()=>{
 const {c}=fixture();c.apiFetch=async()=>json({data:{}});c.patch('contacts','c1','sales_notes','An actual note');await c.flushDb();assert.equal(c._savedEpoch,0);assert.equal(c.state.saveStatus,'error');
});
test('access revocation during a failing save cannot resurrect the cleared workspace',async()=>{
 const {c}=fixture();let complete;c.apiFetch=()=>new Promise(resolve=>{complete=resolve;});c.patch('contacts','c1','sales_notes','Pending note');const saving=c.flushDb();c.state={...c.state,db:null,accessUser:null,meIdUnresolved:true};complete(new Response('<html>Unavailable</html>',{status:503,headers:{'Content-Type':'text/html'}}));await saving;assert.equal(c.state.db,null);assert.equal(c.state.accessUser,null);assert.equal(c._saveInFlight,false);assert.notEqual(c.state.saveStatus,'saved');
});
