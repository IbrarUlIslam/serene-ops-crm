import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {scopeSnapshot} from './user-access.mjs';
const require=createRequire(import.meta.url),{restoreInterfaceBoards,ICONS}=require('./restore-interface-boards.cjs');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const before=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]),template=restoreInterfaceBoards(before);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1],markup=template.slice(0,template.indexOf('<script type="text/x-dc"'));
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture({staff=false,sections=['tickets','work','contacts','activity'],editSections=['tickets','work']}={}){
  const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    location:{hostname:'crm.sereneop.com',origin:'https://crm.sereneop.com'},document:{querySelectorAll:()=>[]},window:{scrollTo(){},addEventListener(){},removeEventListener(){},location:{reload(){}}},
    DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
  vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);
  const c=new context.ReviewComponent();c.props={};c.toast=message=>{c.lastToast=message;};let saves=0;c.persistDb=()=>{saves++;};
  const user={id:staff?'u_zayna':'u_ibrar',orgId:'org1',name:staff?'Zayna Azem':'Ibrar Ul Islam',email:staff?'zayna@example.test':'ibrar@example.test',isOwner:!staff,visibility:{sections,editSections}};
  const full=c.ensureEnhancements({org:{id:'org1',name:'Serene Ops',capacity_hours:230,trigger:.75},users:[{id:'legacy_owner',auth_user_id:'u_ibrar',name:'Ibrar Ul Islam',email:'ibrar@example.test',role:'Owner / Admin'},{id:'legacy_staff',auth_user_id:'u_zayna',name:'Zayna Azem',email:'zayna@example.test',role:'Contributor'}],contacts:[{id:'c1',name:'Assigned Realtor',status:'Client',owner:'Zayna Azem',services:['03'],timezone:'America/New_York',state:'NY'},{id:'c2',name:'Other Private Realtor',status:'Client',owner:'Ibrar Ul Islam',services:['01'],timezone:'America/Los_Angeles',state:'CA'}],deals:[],
    tickets:[{id:'t1',contact_id:'c1',title:'Review CRM automation',body:'Detailed request with a long description that belongs in the details panel.',type:'Request',status:'Inquiry',module:'03',assignee:'Zayna Azem',raised_at:'2026-10-06T14:00:00.000Z',channel:'Email',zoho_message_id:'assigned-mail'},{id:'t2',contact_id:'c2',title:'Private owner ticket',body:'Owner-only request.',type:'Problem',status:'Assigned',module:'01',assignee:'Ibrar Ul Islam',raised_at:'2026-10-01T14:00:00.000Z'},{id:'t3',contact_id:'c1',title:'Archived ticket',status:'Inquiry',module:'03',assignee:'Zayna Azem',archived_at:'2026-10-06T14:00:00.000Z'},{id:'t4',contact_id:'c1',title:'Deleted ticket',status:'Inquiry',module:'03',assignee:'Zayna Azem',deleted_at:'2026-10-06T14:00:00.000Z'}],
    todos:[{id:'w1',contact_id:'c1',ticket_id:'t1',title:'Assigned work',assignee:'Zayna Azem',status:'Open',op_status:'Not Started',module:'03',source:'Requested',due_at:'2026-10-08T14:00:00.000Z',time_logs:[]},{id:'w2',contact_id:'c2',ticket_id:'t2',title:'Other private work',assignee:'Ibrar Ul Islam',status:'Open',module:'01',source:'Requested',due_at:'2026-10-08T14:00:00.000Z',time_logs:[]}],
    activity:[{id:'a1',who:'Zayna Azem',what:'Task set to Open',sub:'A useful explanatory note.',kind:'work',contact_id:'c1',at:'2026-10-07T11:00:00.000Z',target:{section:'work',recordId:'w1'},read:false},{id:'a2',who:'Ibrar Ul Islam',what:'Workspace refreshed',kind:'system',at:'2026-10-07T10:00:00.000Z',read:true}],checklists:{precall:[],onboarding:[]}});
  c.state={...c.state,authChecked:true,accessUser:user,dbLoadFailed:false,meIdUnresolved:false,meId:staff?'legacy_staff':'legacy_owner',db:c.normalizeScopedWorkspace(scopeSnapshot(full,user)),now:Date.parse('2026-10-07T12:00:00.000Z'),view:'tickets'};
  return {c,user,full,saves:()=>saves};
}
function conditionsAt(marker){const at=markup.indexOf(marker);assert.ok(at>=0,marker);const stack=[];for(const m of markup.slice(0,at).matchAll(/<\/?sc-if\b[^>]*>/g)){if(m[0].startsWith('</'))stack.pop();else stack.push(m[0]);}return stack.join(' ');}

test('consistent interface icons return without restoring animal avatars or changing the small logo',()=>{
  assert.match(code,/AVATAR = \{\};/);assert.equal(/\p{Extended_Pictographic}/u.test(markup),false);
  const logos=value=>[...value.matchAll(/<[^>]*class="[^"]*brand-mark[^>]*>/g)].map(m=>m[0]);assert.deepEqual(logos(template),logos(before));assert.ok(logos(template).length);
  for(const key of ['navigation','navigation-group','pipeline-stage','calls','bell','search'])assert.ok(markup.includes('data-ui-icon="'+key+'"'),key);
  const svgs=[...markup.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)];assert.ok(svgs.length>20);for(const match of svgs){assert.match(match[0],/aria-hidden="true"/);assert.match(match[0],/focusable="false"/);assert.match(match[0],/stroke-width="1.7"/);assert.match(match[0],/sc-camel-view-box="0 0 24 24"/);}
});

test('restored control icons keep visible labels, event bindings and permission guards',()=>{
  assert.match(markup,/sc-camel-on-click="\{\{ toggleDialer \}\}"[^>]*>[\s\S]*?data-ui-icon="calls"[\s\S]*?Dialer<\/button>/);
  assert.match(markup,/sc-camel-on-click="\{\{ toggleBell \}\}"[^>]*>[\s\S]*?Notifications/);
  assert.match(conditionsAt('sc-camel-on-click="{{ toggleDialer }}"'),/canManageRecords/);assert.match(conditionsAt('sc-camel-on-click="{{ toggleBell }}"'),/canShowActivity/);
  assert.match(markup,/class="ui-icon-button"[^>]*aria-label="Delete entry"/);assert.match(markup,/<span class="sr-only">Delete entry<\/span>/);
});

test('Tickets shows compact status columns and keeps detailed text in one selected panel',()=>{
  const {c}=fixture();let values=c.renderVals();assert.deepEqual(plain(values.tixCols.map(col=>col.label)),['Inquiry','Assigned','In progress','Waiting on client feedback','Query done']);assert.equal(values.tixSummary,'2 tickets');assert.equal(values.tixCols[0].cards.length,1);assert.equal(values.tixCols[1].cards.length,1);assert.equal(values.hasTicketDetail,false);
  values.tixCols[0].cards[0].toggle();values=c.renderVals();assert.equal(values.hasTicketDetail,true);assert.equal(values.ticketDetail.id,'t1');assert.match(values.ticketDetail.body,/long description/);values.closeTicketDetail();assert.equal(c.state.tixExpand,null);
  const start=markup.indexOf('class="ticket-card-open"'),end=markup.indexOf('</article>',start);assert.doesNotMatch(markup.slice(start,end),/k\.(body|preview)|sc-raw-select/);assert.match(conditionsAt('class="ticket-detail"'),/hasTicketDetail/);
});

test('ticket selection follows Activity links, and changing filters hides a no-longer-visible detail',()=>{
  const {c}=fixture();c.state.tixOpen='t1';let values=c.renderVals();assert.equal(values.ticketDetail.id,'t1');values.onTicketType({target:{value:'Problem'}});values=c.renderVals();assert.equal(values.hasTicketDetail,false);assert.equal(values.tixCols[0].cards.length,0);values.onTicketQ({target:{value:'absent'}});assert.match(c.renderVals().ticketEmptyMessage,/match these filters/);
});

test('editable assigned ticket dragging updates only a visible ticket and remains server-derived',()=>{
  const {c}=fixture({staff:true,sections:['tickets'],editSections:['tickets']});const values=c.renderVals(),card=values.tixCols[0].cards[0];assert.equal(card.draggable,'true');let data;card.dragStart({dataTransfer:{setData:(type,id)=>{data={type,id};}}});assert.deepEqual(data,{type:'text/plain',id:'t1'});
  values.tixCols[1].drop({preventDefault(){},dataTransfer:{getData:()=> 'unknown-id'}});assert.equal(c.state.db.tickets[0].status,'Inquiry');values.tixCols[1].drop({preventDefault(){},dataTransfer:{getData:()=> 't1'}});assert.equal(c.state.db.tickets[0].status,'Assigned');assert.equal(c.state.db.todos.length,0);
});

test('read-only ticket access permits review but offers no creation, dragging or status mutation',()=>{
  const {c,saves}=fixture({staff:true,sections:['tickets'],editSections:[]});const values=c.renderVals(),card=values.tixCols[0].cards[0];assert.equal(values.ticketCanCreate,false);assert.equal(values.ticketReadOnly,true);assert.equal(card.draggable,'false');let prevented=false,writes=0;card.dragStart({preventDefault(){prevented=true;},dataTransfer:{setData(){writes++;}}});assert.equal(prevented,true);assert.equal(writes,0);
  card.onStatus({target:{value:'Query done'}});values.tixCols[1].drop({preventDefault(){},dataTransfer:{getData:()=> 't1'}});values.openNewTicket();assert.equal(c.state.db.tickets[0].status,'Inquiry');assert.equal(c.state.modal,null);assert.equal(saves(),0);card.toggle();assert.equal(c.renderVals().ticketDetail.readOnly,true);
});

test('Tickets without Contacts or Work has minimal record context and no hidden-source links',()=>{
  const {c}=fixture({staff:true,sections:['tickets']});const values=c.renderVals(),card=values.tixCols[0].cards[0];assert.equal(values.tixSummary,'1 ticket');assert.equal(card.client,'Assigned record');assert.equal(card.openClient,null);assert.equal(card.openMail,null);assert.equal(values.ticketShowWork,false);assert.equal(card.hasWork,false);assert.deepEqual(plain(card.kids),[]);assert.match(conditionsAt('class="ticket-detail-work"'),/ticketShowWork/);
});

test('staff linked work opens their Work section rather than the administrator edit modal',()=>{
  const {c}=fixture({staff:true,sections:['tickets','work']});const card=c.renderVals().tixCols[0].cards[0];assert.equal(card.kids.length,1);card.kids[0].go();assert.equal(c.state.view,'work');assert.equal(c.state.wScope,'mine');assert.equal(c.state.modal,null);
});

test('ticket assignee labels resolve account IDs and email aliases to real user names',()=>{
  const {c,user,full}=fixture({staff:true,sections:['tickets']});delete full.tickets[0].assignee;full.tickets[0].assignee_user_id=user.id;c.state.db=c.normalizeScopedWorkspace(scopeSnapshot(full,user));assert.equal(c.renderVals().tixCols[0].cards[0].assignee,'Zayna Azem');
});

test('Activity rows retain all aligned cells even when they have no linked contact',()=>{
  const {c}=fixture();c.state.view='activity';const values=c.renderVals();assert.equal(values.actRows.length,2);assert.equal(values.actRows[0].hasContact,true);assert.equal(values.actRows[0].hasSub,true);assert.equal(values.actRows[1].noContact,true);assert.equal(values.actRows[1].name,'—');assert.equal(values.actRows[0].icon,ICONS.work);
  for(const name of ['activity-icon','activity-summary','activity-person','activity-context','activity-time','activity-action'])assert.match(markup,new RegExp('class="'+name+'"'));
  assert.match(markup,/class="activity-context"><sc-if/);assert.match(markup,/class="activity-action"><sc-if/);assert.doesNotMatch(markup,/<div style="display:grid;grid-template-columns:26px minmax\(200px,2\.4fr\)/);
});

test('staff Activity hides removed contact navigation and preserves assigned event details',()=>{
  const {c}=fixture({staff:true,sections:['activity','work']});c.state.view='activity';const row=c.renderVals().actRows[0];assert.equal(row.who,'Zayna Azem');assert.equal(row.hasContact,false);assert.equal(row.noContact,true);assert.equal(row.name,'—');assert.equal(row.icon,ICONS.work);row.go();assert.equal(c.state.view,'activity');assert.ok(!c.state.contactId);
});

test('interface and board transformation compiles, repeats safely and keeps markup nesting intact',()=>{
  assert.equal(restoreInterfaceBoards(template),template);assert.doesNotThrow(()=>new vm.Script(code));for(const tag of ['div','span','sc-if','sc-for','section','article','svg']){let n=0;for(const match of markup.matchAll(new RegExp('<\\/?'+tag+'\\b[^>]*>','g'))){n+=match[0].startsWith('</')?-1:1;assert.ok(n>=0,tag);}assert.equal(n,0,tag);}
});
