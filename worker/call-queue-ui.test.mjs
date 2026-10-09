import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../call-queue.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../call-queue.html',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const response=(value,status=200)=>({ok:status>=200&&status<300,status,headers:{get:name=>name.toLowerCase()==='content-type'?'application/json':name.toLowerCase()==='etag'?'W/"snapshot-one"':null},json:async()=>value});

async function fixture({readOnly=false,standalone=false,deny=false,sales=false,assignedSales=false,search='?embedded=1'}={}){
  const nodes=new Map(),all=[],listeners=new Map(),messages=[],requests=[],timers=[],intervals=[];let key=0;
  class Node{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.className='';this.attributes={};this.classList={toggle(){}};all.push(this);}
    set id(id){this._id=id;nodes.set(id,this);}get id(){return this._id;}
    append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
    setAttribute(name,value){this.attributes[name]=value;}
    reportValidity(){return !!nodes.get('outcome').value&&(!nodes.get('callback').required||!!nodes.get('callback').value);}
  }
  for(const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Node(match[1]);node.id=match[2];}
  nodes.get('inactivity').value='7';
  const document={getElementById:id=>nodes.get(id)||null,createElement:tag=>new Node(tag),querySelectorAll:selector=>selector==='.queue-client'?all.filter(node=>node.className==='queue-client'):[]};
  const parent={postMessage:(value,origin)=>messages.push({value,origin})};
  const window={parent,addEventListener:(name,fn)=>listeners.set(name,fn),sereneEmbeddedChanged(){}};if(standalone)window.parent=window;
  const now='2026-10-08T15:00:00.000Z';
  const row=(contactId,name,extra={})=>({contactId,name,phone:'+15550000001',timezone:'America/New_York',localNow:'Thu 11:00 AM EDT',pktNow:'Thu 8:00 PM PKT',inactiveDays:10,historyLabel:'10 days since connected conversation',lastMeaningfulAt:'2026-09-28T15:00:00.000Z',windowClosingMinutes:60,closesAt:'2026-10-08T16:00:00.000Z',closesLocal:'Thu 12:00 PM EDT',closesPKT:'Thu 9:00 PM',reasons:[],...extra});
  const payload={available:[row('c_due','Fictional callback client',{callbackAt:'2026-10-08T14:00:00.000Z'}),row('c_idle','Fictional inactive client',{inactiveDays:21})],upcoming:[row('c_later','Fictional later client',{opensAt:'2026-10-09T13:00:00.000Z',opensLocal:'Fri 9:00 AM EDT',opensPKT:'Fri 6:00 PM',reasons:['Outside current calling hours.']})],review:[row('c_review','Fictional missing details',{phone:'',timezone:'',localNow:'',inactiveDays:null,historyLabel:'History not assessed',reasons:['Confirm a phone number and time zone.']})],serverNow:now,callerTimezone:'Asia/Karachi',inactivityDays:7,canCall:!readOnly,canLog:!readOnly,snapshotVersion:'snapshot-one',historyCoverage:{label:'Recorded CRM history only. Live Zoho inbox is not included.'}};
  payload.queueMode=sales?'sales':'client_followup';payload.contactScope=sales?(assignedSales?'assigned':'all_sales'):'assigned';
  if(sales)for(const item of [...payload.available,...payload.upcoming,...payload.review]){item.status='Not contacted';item.firstSalesOutreach=true;}
  const context={document,window,location:{origin:'https://crm.example.invalid',search},URLSearchParams,Date,Intl,JSON,Number,String,Map,Math,console,crypto:{randomUUID:()=> 'attempt-'+(++key)},confirm:()=>true,setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){},setInterval:(fn,delay)=>{intervals.push({fn,delay});return intervals.length;}};
  context.fetch=async(path,options)=>{requests.push({path,options});return response(deny?{error:'No queue access.'}:payload,deny?403:200);};
  vm.createContext(context);vm.runInContext(code.replace(/\}\)\(\);\s*$/,"globalThis.review={load,select,startCall,saveOutcome,receiveCall,callbackISO,getSelected:()=>selected};})();"),context);await settle();
  return {nodes,all,listeners,messages,requests,timers,intervals,payload,context,window,parent,review:context.review};
}
const prevent={preventDefault(){}};
function warned(fixture){let warned=false;fixture.listeners.get('beforeunload')({preventDefault(){warned=true;}});return warned;}
function change(fixture,id,value){const node=fixture.nodes.get(id);node.value=value;(node.oninput||node.onchange)?.();}
function reply(fixture,values={}){const sent=fixture.messages.findLast(message=>message.value.type==='serene-call-queue-call').value;fixture.listeners.get('message')({origin:'https://crm.example.invalid',source:fixture.parent,data:{type:'serene-call-queue-call-result',requestId:sent.requestId,contactId:sent.contactId,ok:true,idempotencyKey:'checked-key',...values}});}

test('fictional queue shows backend order and timing; opening and Next never dispatch a call',async()=>{
  const fixture=await fixtureQueue();
  const buttons=fixture.nodes.get('now-list').children;assert.equal(buttons[0].children[0].textContent,'Fictional callback client');assert.match(buttons[0].children[1].textContent,/Callback due/);assert.match(buttons[0].children[2].textContent,/Closes in 60 min/);
  assert.equal(fixture.nodes.get('later-list').children[0].children[2].textContent,'Opens Fri 6:00 PM PKT');assert.match(fixture.nodes.get('review-list').children[0].children[2].textContent,/Confirm a phone number/);
  assert.equal(fixture.requests.length,1);assert.equal(fixture.requests[0].options.method,'GET');assert.equal(fixture.messages.length,0);assert.equal(warned(fixture),false);
  fixture.nodes.get('next').onclick();assert.equal(fixture.review.getSelected().contactId,'c_idle');assert.equal(fixture.messages.length,0);assert.equal(fixture.requests.length,1);
});
async function fixtureQueue(options){return fixture(options);}

test('reservation controls hold the selected contact without dialing and expose only own lease',async()=>{
 const f=await fixtureQueue();f.payload.reservationsEnabled=true;
 f.context.fetch=async(path,options)=>{f.requests.push({path,options});if(path.endsWith('/claim')){f.payload.available[0].reservedByMe=true;f.payload.available[0].reservedUntil='2026-10-08T14:15:00Z';return response({ok:true});}if(path.endsWith('/release')){delete f.payload.available[0].reservedByMe;delete f.payload.available[0].reservedUntil;return response({ok:true});}return response(f.payload);};
 await f.review.load();assert.equal(f.nodes.get('reserve').hidden,false);await f.nodes.get('reserve').onclick();assert.equal(f.nodes.get('reserve').hidden,true);assert.equal(f.nodes.get('release').hidden,false);assert.equal(f.messages.length,0);
 await f.nodes.get('release').onclick();assert.equal(f.nodes.get('release').hidden,true);assert.equal(f.messages.length,0);
});

test('read-only assigned staff can view clients but cannot call or log an outcome',async()=>{
  const fixture=await fixtureQueue({readOnly:true});assert.equal(fixture.nodes.get('dial').disabled,true);assert.equal(fixture.nodes.get('save').disabled,true);fixture.review.startCall();await fixture.review.saveOutcome(prevent);assert.equal(fixture.requests.length,1);assert.equal(fixture.messages.length,0);
});

test('available-later and review clients cannot initiate calls; standalone retains manual logging',async()=>{
  const fixture=await fixtureQueue();fixture.review.select(fixture.payload.upcoming[0]);assert.equal(fixture.nodes.get('dial').disabled,true);fixture.review.startCall();assert.equal(fixture.messages.length,0);fixture.review.select(fixture.payload.review[0]);assert.equal(fixture.nodes.get('dial').disabled,true);
  const standalone=await fixtureQueue({standalone:true});assert.equal(standalone.nodes.get('dial').disabled,true);assert.equal(standalone.nodes.get('save').disabled,false);assert.match(standalone.nodes.get('call-help').textContent,/outside the CRM/);
});

test('deliberate dial uses IDs only, waits for trusted response, and never assumes Connected',async()=>{
  const fixture=await fixtureQueue();fixture.nodes.get('dial').onclick();const call=fixture.messages.at(-1).value;assert.deepEqual(JSON.parse(JSON.stringify(call)),{type:'serene-call-queue-call',requestId:'attempt-1',contactId:'c_due',inactivityDays:7});assert.equal(fixture.nodes.get('dial').disabled,true);assert.equal(warned(fixture),true);
  fixture.listeners.get('message')({origin:'https://untrusted.example',source:fixture.parent,data:{type:'serene-call-queue-call-result',...call,ok:true}});assert.equal(fixture.nodes.get('dial').disabled,true);
  fixture.listeners.get('message')({origin:'https://crm.example.invalid',source:{},data:{type:'serene-call-queue-call-result',requestId:call.requestId,contactId:call.contactId,ok:true}});assert.equal(warned(fixture),true);
  reply(fixture);assert.equal(fixture.nodes.get('outcome').value,'');assert.equal(fixture.nodes.get('dial').disabled,true);assert.equal(warned(fixture),true);assert.equal(fixture.nodes.get('discard').hidden,false);assert.equal(fixture.requests.length,1);
});

test('timeout never re-dials and stopping the wait does not perform a phone action',async()=>{
  const fixture=await fixtureQueue();fixture.review.startCall();fixture.timers[0].fn();assert.equal(fixture.nodes.get('stop-waiting').hidden,false);assert.equal(fixture.messages.length,1);assert.equal(fixture.nodes.get('dial').disabled,true);fixture.nodes.get('stop-waiting').onclick();assert.equal(fixture.messages.length,1);assert.equal(warned(fixture),false);
});

test('actual drafts warn; reverting fields and GET refresh clear or preserve them correctly',async()=>{
  const fixture=await fixtureQueue();change(fixture,'outcome','No answer');change(fixture,'notes','A draft note');assert.equal(warned(fixture),true);change(fixture,'notes','');change(fixture,'outcome','');assert.equal(warned(fixture),false);
  change(fixture,'outcome','Call back later');change(fixture,'callback','2026-10-09T10:00');change(fixture,'outcome','');assert.equal(warned(fixture),false);
  change(fixture,'outcome','No answer');change(fixture,'notes','Keep this note');await fixture.review.load();assert.equal(fixture.nodes.get('notes').value,'Keep this note');assert.equal(warned(fixture),true);
});

test('a pending GET does not warn and failed refresh disables actions without losing a draft',async()=>{
  const fixture=await fixtureQueue();let release;fixture.context.fetch=()=>new Promise(resolve=>{release=resolve;});const reading=fixture.review.load();assert.equal(warned(fixture),false);release(response(fixture.payload));await reading;
  change(fixture,'outcome','No answer');change(fixture,'notes','Retained draft');fixture.context.fetch=async()=>response({error:'Session expired.'},403);await fixture.review.load();assert.equal(fixture.nodes.get('notes').value,'Retained draft');assert.equal(fixture.nodes.get('dial').disabled,true);assert.equal(fixture.nodes.get('save').disabled,true);
});

test('successful manually recorded outcome uses UUID and revision, then refreshes parent without calling',async()=>{
  const fixture=await fixtureQueue();let payload,request;fixture.context.fetch=async(path,options)=>{if(options.method==='POST'){payload=JSON.parse(options.body);request=options;return response({ok:true,duplicate:false,updatedAt:'snapshot-two'});}return response(fixture.payload);};
  change(fixture,'outcome','Connected');change(fixture,'notes','Reviewed launch priorities.');await fixture.review.saveOutcome(prevent);
  assert.equal(payload.idempotencyKey,'attempt-1');assert.equal(payload.contactId,'c_due');assert.equal(payload.outcome,'Connected');assert.equal(request.headers['If-Match'],'"snapshot-one"');assert.equal(warned(fixture),false);assert.ok(fixture.messages.some(message=>message.value.type==='serene-call-queue-updated'));assert.equal(fixture.messages.some(message=>message.value.type==='serene-call-queue-call'),false);
});

test('dispatched outcomes retain the server checked idempotency key',async()=>{
  const fixture=await fixtureQueue();fixture.review.startCall();reply(fixture);let key;fixture.context.fetch=async(path,options)=>{if(options.method==='POST'){key=JSON.parse(options.body).idempotencyKey;return response({ok:true,updatedAt:'next'});}return response(fixture.payload);};change(fixture,'outcome','No answer');await fixture.review.saveOutcome(prevent);assert.equal(key,'checked-key');
});

test('dispatch survives minute refresh without redial, losing its key or leaving the selected client',async()=>{
  const fixture=await fixtureQueue();fixture.review.startCall();reply(fixture);fixture.intervals[0].fn();await settle();
  assert.equal(fixture.review.getSelected().contactId,'c_due');assert.equal(fixture.nodes.get('dial').disabled,true);assert.equal(warned(fixture),true);assert.equal(fixture.messages.filter(message=>message.value.type==='serene-call-queue-call').length,1);
  fixture.context.confirm=()=>false;fixture.nodes.get('next').onclick();assert.equal(fixture.review.getSelected().contactId,'c_due');
  let key;fixture.context.fetch=async(path,options)=>{if(options.method==='POST'){key=JSON.parse(options.body).idempotencyKey;return response({ok:true,updatedAt:'saved'});}return response(fixture.payload);};change(fixture,'outcome','No answer');await fixture.review.saveOutcome(prevent);assert.equal(key,'checked-key');assert.equal(warned(fixture),false);assert.equal(fixture.messages.findLast(message=>message.value.type==='serene-call-queue-updated').value.contactId,'c_due');
});

test('Next advances only through Available now, never wraps or selects later or review',async()=>{
  const fixture=await fixtureQueue();fixture.nodes.get('next').onclick();assert.equal(fixture.review.getSelected().contactId,'c_idle');assert.equal(fixture.nodes.get('next').disabled,true);fixture.nodes.get('next').onclick();assert.equal(fixture.review.getSelected().contactId,'c_idle');assert.equal(fixture.messages.length,0);
  fixture.nodes.get('later-list').children[0].onclick();assert.equal(fixture.review.getSelected().contactId,'c_later');assert.equal(fixture.nodes.get('dial').disabled,true);assert.match(fixture.nodes.get('coverage').textContent,/Live Zoho inbox is not included/);
});

test('only explicit confirmed discard clears a dispatched pending outcome in parent',async()=>{
  const fixture=await fixtureQueue();fixture.review.startCall();reply(fixture);fixture.context.confirm=()=>false;fixture.nodes.get('discard').onclick();assert.equal(warned(fixture),true);assert.equal(fixture.messages.some(message=>message.value.type==='serene-call-queue-discarded'),false);
  fixture.context.confirm=()=>true;fixture.nodes.get('discard').onclick();assert.equal(warned(fixture),false);assert.equal(fixture.messages.findLast(message=>message.value.type==='serene-call-queue-discarded').value.contactId,'c_due');assert.equal(fixture.requests.length,1);
});

test('unknown save result retains the identical key and payload for retry without duplicate calls',async()=>{
  const fixture=await fixtureQueue();const saves=[];let attempts=0;fixture.context.fetch=async(path,options)=>{if(options.method==='POST'){saves.push(JSON.parse(options.body));attempts++;if(attempts===1)throw Error('Connection interrupted');return response({ok:true,duplicate:true,updatedAt:'saved'});}return response(fixture.payload);};
  change(fixture,'outcome','No answer');change(fixture,'notes','Agent did not answer.');await fixture.review.saveOutcome(prevent);assert.equal(warned(fixture),true);assert.equal(fixture.nodes.get('notes').readOnly,true);await fixture.review.saveOutcome(prevent);assert.deepEqual(saves[0],saves[1]);assert.equal(warned(fixture),false);assert.match(fixture.nodes.get('notice').textContent,/No duplicate/);
});

test('save conflict retains editable notes and displays recovery; callback converts explicit PKT',async()=>{
  const fixture=await fixtureQueue();fixture.context.fetch=async()=>response({error:'Workspace changed.'},409);change(fixture,'outcome','No answer');change(fixture,'notes','Do not lose this note.');await fixture.review.saveOutcome(prevent);assert.equal(fixture.nodes.get('notes').value,'Do not lose this note.');assert.equal(fixture.nodes.get('notes').readOnly,false);assert.match(fixture.nodes.get('notice').textContent,/Refresh the queue/);
  change(fixture,'outcome','Call back later');change(fixture,'callback','2026-10-09T09:30');assert.equal(fixture.review.callbackISO(),'2026-10-09T04:30:00.000Z');
});

test('three-minute refresh is read only and skips hidden pages or pending outcomes',async()=>{
  const fixture=await fixtureQueue();assert.equal(fixture.intervals[0].delay,180000);fixture.intervals[0].fn();await settle();assert.equal(fixture.requests.length,2);assert.equal(fixture.requests.every(request=>request.options.method==='GET'),true);assert.equal(fixture.messages.length,0);
  fixture.context.document.hidden=true;fixture.intervals[0].fn();await settle();assert.equal(fixture.requests.length,2);fixture.context.document.hidden=false;
  change(fixture,'outcome','No answer');fixture.intervals[0].fn();await settle();assert.equal(fixture.requests.length,2);
});

test('filter changes respect actual drafts and request only supported chosen threshold',async()=>{
  const fixture=await fixtureQueue();change(fixture,'outcome','No answer');fixture.context.confirm=()=>false;fixture.nodes.get('inactivity').value='14';fixture.nodes.get('inactivity').onchange();assert.equal(fixture.nodes.get('inactivity').value,'7');assert.equal(fixture.requests.length,1);
  fixture.context.confirm=()=>true;fixture.context.fetch=async(path,options)=>{fixture.requests.push({path,options});return response({...fixture.payload,inactivityDays:30});};fixture.nodes.get('inactivity').value='30';fixture.nodes.get('inactivity').onchange();await settle();assert.match(fixture.requests.at(-1).path,/inactivityDays=30/);assert.equal(warned(fixture),false);
});

test('trusted Sales queue shows contact status and first outreach with all-sales or assigned scope',async()=>{
  const f=await fixtureQueue({sales:true});assert.equal(f.nodes.get('queue-title').textContent,'Next to call');assert.equal(f.nodes.get('dial').textContent,'Call contact');assert.equal(f.nodes.get('next').textContent,'Next contact');assert.equal(f.nodes.get('detail').attributes['aria-label'],'Selected contact');assert.match(f.nodes.get('scope').textContent,/All permitted contacts/);assert.equal(f.nodes.get('period-label').textContent,'Contact activity');assert.match(f.nodes.get('coverage').textContent,/First recorded prospect outreach is not delayed by contact creation/);
  const facts=f.nodes.get('client-facts').children;assert.equal(facts[0].children[0].textContent,'Sales status');assert.equal(facts[0].children[1].textContent,'Not contacted');assert.equal(facts[1].children[1].textContent,'No meaningful contact recorded');assert.match(f.nodes.get('call-help').textContent,/own CRM phone is not connected/);assert.equal(f.context.document.title,'Next to call | Serene Ops');assert.equal(f.nodes.get('queue-list').attributes['aria-label'],'Calling list');assert.match(f.nodes.get('callback-hint').textContent,/contact’s calling hours/);
  const scoped=await fixtureQueue({sales:true,assignedSales:true});assert.match(scoped.nodes.get('scope').textContent,/Only your assigned contacts/);assert.ok(!scoped.nodes.get('scope').textContent.includes('All permitted'));
});

test('Sales Next never starts a call and deliberate dial sends only contact ID and spacing',async()=>{
  const f=await fixtureQueue({sales:true});f.nodes.get('next').onclick();assert.equal(f.messages.length,0);assert.equal(f.review.getSelected().contactId,'c_idle');f.nodes.get('dial').onclick();assert.deepEqual(JSON.parse(JSON.stringify(f.messages.at(-1).value)),{type:'serene-call-queue-call',requestId:'attempt-1',contactId:'c_idle',inactivityDays:7});assert.equal(f.requests.length,1);
});

test('Sales external manual call logging preserves actual outcome and callback PKT without transmitting profile or scope',async()=>{
  const f=await fixtureQueue({sales:true,standalone:true});assert.equal(f.nodes.get('dial').disabled,true);assert.equal(f.nodes.get('save').disabled,false);assert.match(f.nodes.get('call-help').textContent,/call made outside the CRM/);
  let saved;f.context.fetch=async(path,options)=>{if(options.method==='POST'){saved=JSON.parse(options.body);return response({ok:true,updatedAt:'sales-next'});}return response(f.payload);};change(f,'outcome','Call back later');change(f,'notes','Asked for a callback tomorrow.');change(f,'callback','2026-10-09T19:00');await f.review.saveOutcome(prevent);
  assert.deepEqual(Object.keys(saved).sort(),['callbackAt','contactId','idempotencyKey','inactivityDays','note','outcome']);assert.equal(saved.outcome,'Call back later');assert.equal(saved.callbackAt,'2026-10-09T14:00:00.000Z');assert.equal(saved.note,'Asked for a callback tomorrow.');assert.equal(f.messages.length,0);assert.equal(warned(f),false);
});

test('Sales read-only mode exposes calling context but no phone or logging mutation',async()=>{
  const f=await fixtureQueue({sales:true,readOnly:true});assert.equal(f.nodes.get('queue-title').textContent,'Next to call');assert.match(f.nodes.get('scope').textContent,/View only/);assert.equal(f.nodes.get('dial').disabled,true);assert.equal(f.nodes.get('outcome').disabled,true);assert.equal(f.nodes.get('notes').readOnly,true);assert.equal(f.nodes.get('save').disabled,true);f.review.startCall();await f.review.saveOutcome(prevent);assert.equal(f.requests.length,1);assert.equal(f.messages.length,0);
});

test('request URL cannot turn a trusted Client queue into Sales mode or change assignment scope',async()=>{
  const f=await fixtureQueue({search:'?embedded=1&mode=sales&scope=all_sales&profile=sales_associate'});assert.equal(f.nodes.get('queue-title').textContent,'Next to call');assert.equal(f.nodes.get('dial').textContent,'Call contact');assert.equal(f.nodes.get('next').textContent,'Next contact');assert.match(f.nodes.get('scope').textContent,/Only your assigned contacts/);assert.equal(f.requests[0].path,'/api/call-queue?inactivityDays=7');
});
