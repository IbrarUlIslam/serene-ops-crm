import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const template=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];

function fixture(contacts=[{id:'c1',name:'Fictional review contact',timezone:'',timezone_review:true,state:'',status:'Not contacted',services:[]}]){
  const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
  vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);
  const c=new context.ReviewComponent();c.props={};c.persistDb=()=>{};c.toast=message=>{c.lastToast=message;};c.state.authChecked=true;
  c.state.accessUser={isOwner:true,email:'owner@example.com',visibility:{sections:['contacts','clients','calls','pipeline','work','tickets','calendar','social'],editSections:[]}};
  c.state.db=c.ensureEnhancements({org:{id:'org1',capacity_hours:230,trigger:.75},users:[{id:'u1',name:'Ibrar Ul Islam',email:'owner@example.com'}],contacts:structuredClone(contacts),todos:[],tickets:[],deals:[],checklists:{precall:[],onboarding:[]}});
  c.state.meId='u1';c.state.contactId=contacts[0]?.id;c.state.view='contacts';c.state.fStatus='All';c.state.fService='All';
  c.x=()=>({db:c.state.db,live:c.state.db.contacts,clients:c.state.db.contacts.filter(x=>x.status==='Client'),byId:Object.fromEntries(c.state.db.contacts.map(x=>[x.id,x])),wStart:9,wEnd:17});
  return c;
}

function zoneField(c){return c.contactVals(c.x()).cd.fields.find(f=>f.label==='Time zone');}

test('migration preserves an imported unknown zone across repeated normalization and unrelated edits',()=>{
  const c=fixture();let contact=c.state.db.contacts[0];
  assert.equal(contact.timezone,'');assert.equal(contact.timezone_review,true);
  c.ensureEnhancements(c.state.db);assert.equal(contact.timezone,'');
  c.contactVals(c.x()).cd.fields.find(f=>f.label==='Name').onChange({target:{value:'Fictional renamed contact'}});
  contact=c.state.db.contacts[0];assert.equal(contact.name,'Fictional renamed contact');assert.equal(contact.timezone,'');assert.equal(contact.timezone_review,true);
});

test('legacy unflagged contacts retain their prior state-based compact defaults',()=>{
  const c=fixture([{id:'c1',name:'Fictional legacy contact',state:'CA',timezone:'',status:'Not contacted',services:[]}]);
  const contact=c.state.db.contacts[0];assert.equal(contact.timezone,'America/Los_Angeles');assert.equal(contact.owner,'Ibrar Ul Islam');assert.equal(contact.call_start,9);assert.equal(contact.call_end,18);assert.equal(contact.timezone_review,undefined);
});

test('unknown listing clocks are honest and never qualify as inside local calling hours',()=>{
  const c=fixture();const row=c.contactsVals(c.x()).contactRows[0];
  assert.equal(row.time,'Unknown');assert.equal(row.abbr,'');assert.equal(c.clockS(''),'Unknown');assert.equal(c.work('',0,24).ok,false);
  c.state.fCallable=true;assert.equal(c.contactsVals(c.x()).contactRows.length,0);
  assert.equal(c.contactTZ('c1'),'');
});

test('contact details and drawer display review instead of a fabricated New York clock',()=>{
  const c=fixture();const detail=c.contactVals(c.x()).cd;
  assert.equal(detail.time,'Unknown');assert.equal(detail.zoneLine,'Time zone needs review');assert.equal(detail.callable,'Time zone unknown');
  assert.equal(detail.detailRows.find(r=>r.k==='Time zone').v,'Unknown — review needed');
  c.state.drawerId='c1';const drawer=c.drawerVals(c.x()).dw;assert.equal(drawer.time,'Unknown');assert.equal(drawer.zoneLine,'Time zone needs review');
});

test('the unknown zone editor has a matching review placeholder and state changes preserve it',()=>{
  const c=fixture();let field=zoneField(c);assert.equal(field.value,'Choose a time zone');assert.ok(field.options.includes(field.value));assert.match(field.hint,/unknown/);
  field.onChange({target:{value:'Choose a time zone'}});assert.equal(c.state.db.contacts[0].timezone,'');
  c.contactVals(c.x()).cd.fields.find(f=>f.label==='State').onChange({target:{value:'FL'}});
  assert.equal(c.state.db.contacts[0].state,'FL');assert.equal(c.state.db.contacts[0].timezone,'');assert.equal(c.state.db.contacts[0].timezone_review,true);
  field=zoneField(c);assert.equal(field.value,'Choose a time zone');
});

test('explicit valid zone selection confirms the zone and removes the estimated source label',()=>{
  const c=fixture();zoneField(c).onChange({target:{value:'Eastern'}});const contact=c.state.db.contacts[0];
  assert.equal(contact.timezone,'America/New_York');assert.equal(contact.timezone_review,false);assert.equal(contact.tz_source,'manual');
  assert.equal(zoneField(c).value,'Eastern');assert.ok(!c.contactVals(c.x()).cd.zoneLine.includes('estimate'));
});

test('valid unlisted imported time zones remain present and unchanged through edits',()=>{
  const zones=['America/Boise','America/Detroit','America/Indiana/Indianapolis','America/Phoenix','America/Toronto','America/Vancouver','Asia/Karachi'];
  for(const zone of zones){
    const c=fixture([{id:'c1',name:'Fictional area estimate',state:'',timezone:zone,tz_source:'area',status:'Not contacted',services:[]}]);
    let field=zoneField(c);assert.ok(field.options.includes(field.value),zone);assert.equal(c.tzByLabel(field.value),zone);
    c.contactVals(c.x()).cd.fields.find(f=>f.label==='Brokerage').onChange({target:{value:'Fictional brokerage'}});
    assert.equal(c.state.db.contacts[0].timezone,zone);
    c.contactVals(c.x()).cd.fields.find(f=>f.label==='State').onChange({target:{value:'NY'}});assert.equal(c.state.db.contacts[0].timezone,zone);assert.equal(c.state.db.contacts[0].tz_source,'area');
    field=zoneField(c);field.onChange({target:{value:field.value}});assert.equal(c.state.db.contacts[0].timezone,zone);assert.equal(c.state.db.contacts[0].tz_source,'manual');
  }
});

test('area-derived time zones are visibly estimates while known manual zones remain concise',()=>{
  const c=fixture([{id:'c1',name:'Fictional area estimate',state:'CA',timezone:'America/Los_Angeles',tz_source:'area',status:'Not contacted',services:[]}]);
  let detail=c.contactVals(c.x()).cd;assert.match(detail.zoneLine,/estimate$/);assert.equal(detail.detailRows.find(r=>r.k==='Time zone').v,'Pacific · estimate');assert.match(zoneField(c).hint,/Estimated from phone area/);
  c.state.db.contacts[0].tz_source='manual';detail=c.contactVals(c.x()).cd;assert.ok(!detail.zoneLine.includes('estimate'));assert.equal(detail.detailRows.find(r=>r.k==='Time zone').v,'Pacific');
});

test('unknown zones cannot silently schedule a meeting through a client-zone default',()=>{
  const c=fixture();c.state.modal='newdeal';c.state.draft={contact:c.state.db.contacts[0].name,stage:'Demo scheduled',date:'2026-10-09',time:'10:00',timezone:'Client · '};
  c.saveModal(c.x());assert.equal(c.state.db.deals.length,0);assert.match(c.state.err,/valid meeting date and time/);
  c.state.draft.timezone='Eastern';c.saveModal(c.x());assert.equal(c.state.db.deals.length,1);assert.equal(c.state.db.deals[0].meeting_at,'2026-10-09T14:00:00.000Z');assert.equal(c.state.db.contacts[0].timezone,'');
});

test('opening a new deal or work item for an unknown first contact requires an explicit zone',()=>{
  const c=fixture();c.pipeVals(c.x()).openNewDeal();assert.equal(c.state.draft.timezone,'Choose a time zone');
  c.openNewWork(c.x());assert.equal(c.state.draft.timezone,'Choose a time zone');
  c.contactVals(c.x()).cd.addReminder();assert.equal(c.state.draft.timezone,'Choose a time zone');
  c.openNewMeeting('c1');assert.equal(c.state.draft.timezone,'Choose a time zone');
  c.state.draft.kind='Fictional discovery';c.saveModal(c.x());assert.equal(c.state.db.meetings.length,0);assert.ok(c.state.err);
});

test('a contact note without a confirmed zone is displayed in GMT with an honest label',()=>{
  const c=fixture();c.state.db.notes.push({id:'n1',entity_type:'contact',entity_id:'c1',body:'Fictional import note',at:'2026-10-08T12:00:00Z'});
  const note=c.contactVals(c.x()).cd.notes[0];assert.match(note.when,/GMT · client time zone unknown$/);assert.ok(!note.when.includes('their time'));
});

test('a large mixed imported list renders and filters unknown zones without corrupting records',()=>{
  const contacts=Array.from({length:4500},(_,i)=>({id:'c'+i,name:'Fictional QA '+String(i).padStart(4,'0'),state:'',timezone:i%10===0?'':'America/Detroit',...(i%10===0?{timezone_review:true}:{tz_source:'area'}),status:'Not contacted',services:[]}));
  const c=fixture(contacts);const started=performance.now();const rows=c.contactsVals(c.x()).contactRows;
  assert.equal(rows.length,100);assert.equal(rows.filter(r=>r.time==='Unknown').length,10);assert.equal(c.state.db.contacts.filter(r=>r.timezone==='').length,450);
  assert.equal(c.contactsVals(c.x()).contactPages,45);assert.equal(c.contactsVals(c.x()).contactCount,'4500 of 4500 contacts');
  const elapsed=performance.now()-started;console.info('Fictional 4,500-contact view-model build: '+Math.round(elapsed)+'ms');
  assert.ok(elapsed<5000,'The mixed list must finish without runaway processing.');
});

test('native script compiles and all principal views can render unknown contacts without events',()=>{
  assert.doesNotThrow(()=>new vm.Script(code));const c=fixture();
  for(const view of ['contacts','contact','pipeline','clients','calls','today','work','tickets','calendar','social','reports','settings']){
    c.state.view=view;assert.doesNotThrow(()=>c.renderVals(),view);
  }
});

test('unknown client zones safely render future meeting timestamps with or without an explicit event zone',()=>{
  for(const eventZone of ['', 'America/Phoenix']){
    const c=fixture();c.state.db.meetings.push({id:'m1',contact_id:'c1',kind:'Fictional discovery',at:new Date(c.state.now+3600000).toISOString(),timezone:eventZone});
    for(const view of ['today','contact','calendar','pipeline']){c.state.view=view;assert.doesNotThrow(()=>c.renderVals(),view+' '+eventZone);}
  }
});

function pagedContacts(count=231){return Array.from({length:count},(_,i)=>({id:'c'+i,name:'Fictional page '+String(i).padStart(4,'0'),state:i%2===0?'NY':'CA',timezone:'America/New_York',status:i%2===0?'Contacted':'Not contacted',services:[],tags:i===230?['Distant tag']:[]}));}

test('Contacts pages show bounded ranges and keep search and tag filters global',()=>{
  const c=fixture(pagedContacts());let view=c.contactsVals(c.x());assert.equal(view.contactRows.length,100);assert.equal(view.contactPageLabel,'Page 1 of 3');assert.equal(view.contactRange,'Showing 1–100 of 231 matches');
  view.contactNextPage();view=c.contactsVals(c.x());assert.equal(view.contactRows[0].id,'c100');assert.equal(view.contactRange,'Showing 101–200 of 231 matches');
  view.contactNextPage();view=c.contactsVals(c.x());assert.equal(view.contactRows.length,31);assert.equal(view.contactLastPage,true);
  view.onQ({target:{value:'0230'}});view=c.contactsVals(c.x());assert.equal(c.state.contactPage,1);assert.equal(view.contactRows[0].id,'c230');assert.equal(view.contactCount,'1 of 231 contacts');
  view.clearContactFilters();view=c.contactsVals(c.x());view.onFTag({target:{value:'Distant tag'}});assert.equal(c.contactsVals(c.x()).contactRows[0].id,'c230');
});

test('all Contacts filter changes and saved views reset the page without narrowing the data set',()=>{
  const c=fixture(pagedContacts());
  for(const [handler,value] of [['onQ','Fictional'],['onFStatus','All'],['onFService','All'],['onFState','All'],['onFTag','All']]){
    c.state.contactPage=3;c.contactsVals(c.x())[handler]({target:{value}});assert.equal(c.state.contactPage,1,handler);
  }
  c.state.contactPage=3;c.contactsVals(c.x()).onFCallable({target:{checked:false}});assert.equal(c.state.contactPage,1);
  c.state.db.user_prefs.u1.contactViews=[{id:'v1',label:'Fictional saved view',filters:{q:'0230'}}];c.state.contactPage=3;c.contactsVals(c.x()).contactViews[0].apply();assert.equal(c.state.contactPage,1);assert.equal(c.contactsVals(c.x()).contactRows[0].id,'c230');
  c.state.contactPage=3;c.contactsVals(c.x()).clearContactFilters();assert.equal(c.state.contactPage,1);assert.equal(c.contactsVals(c.x()).contactCount,'231 of 231 contacts');
});

test('select-all selects only the visible page and preserves explicit selections on other pages',()=>{
  const c=fixture(pagedContacts());let view=c.contactsVals(c.x());view.bulkContactsToggleAll();assert.equal(c.bulkIds('contacts').length,100);
  view.contactNextPage();view=c.contactsVals(c.x());assert.equal(view.bulkContactsAll,false);assert.equal(view.bulkContactsCount,'100 selected');
  view.bulkContactsToggleAll();view=c.contactsVals(c.x());assert.equal(c.bulkIds('contacts').length,200);assert.equal(view.bulkContactsAll,true);assert.equal(view.bulkContactsCount,'200 selected');
  view.bulkContactsToggleAll();assert.equal(c.bulkIds('contacts').length,100);assert.ok(c.bulkIds('contacts').every(id=>Number(id.slice(1))<100));
  view=c.contactsVals(c.x());view.bulkContactsStatus();assert.equal(c.state.draft.ids.length,100);
  view.bulkContactsClear();assert.equal(c.bulkIds('contacts').length,0);
});

test('Contacts pages clamp after shrinking the visible record set and handle an empty filtered result',()=>{
  const c=fixture(pagedContacts());c.state.contactPage=3;c.state.db.contacts=c.state.db.contacts.slice(0,150);let view=c.contactsVals(c.x());
  assert.equal(view.contactPage,2);assert.equal(view.contactRows.length,50);assert.equal(view.contactRange,'Showing 101–150 of 150 matches');assert.equal(view.contactLastPage,true);
  view.contactPrevPage();assert.equal(c.state.contactPage,1);
  c.state.q='No fictional match';view=c.contactsVals(c.x());assert.equal(view.contactRows.length,0);assert.equal(view.contactsEmpty,true);assert.equal(view.contactPage,1);assert.equal(view.contactPaged,false);
});

test('missing, null and blank optional contact fields display placeholders without modifying compact records',()=>{
  for(const value of [undefined,null,'   ']){
    const contact={id:'c1',name:'Fictional optional contact',timezone:'',timezone_review:true,status:'Not contacted',services:[],tags:['Fictional import']};
    if(value!==undefined){contact.email=value;contact.phone=value;contact.brokerage=value;contact.state=value;}
    const c=fixture([contact]);const before=JSON.stringify(c.state.db.contacts[0]);let row=c.contactsVals(c.x()).contactRows[0];
    assert.equal(row.email,'No email · Fictional import');assert.equal(row.brokerage,'—');assert.ok(!/undefined|null/.test(row.email));
    const detail=c.contactVals(c.x()).cd;assert.ok(detail.detailRows.every(r=>!/^undefined$|^null$/.test(r.v)));
    c.state.drawerId='c1';assert.doesNotThrow(()=>c.drawerVals(c.x()));assert.equal(JSON.stringify(c.state.db.contacts[0]),before);
    if(value===undefined)assert.equal(Object.prototype.hasOwnProperty.call(c.state.db.contacts[0],'email'),false);
  }
});

test('contact and global search never match missing fields as undefined or null text',()=>{
  const c=fixture([{id:'c1',name:'Fictional optional contact',timezone:'',timezone_review:true,status:'Not contacted',services:[]}]);
  for(const query of ['undefined','null']){c.state.q=query;assert.equal(c.contactsVals(c.x()).contactRows.length,0);c.state.gq=query;assert.equal(c.renderVals().searchEmpty,true);}
  c.state.gq='optional';
  const groups=c.renderVals().searchGroups;assert.ok(groups.length>0);assert.ok(groups.every(g=>!JSON.stringify(g).includes('undefined')));
});

test('imported last activity stays source text with an explicit unknown time-zone label',()=>{
  const c=fixture([{id:'c1',name:'Fictional source contact',timezone:'America/New_York',status:'Not contacted',services:[],source_last_activity:'2026-09-10 14:32'}]);
  const before=JSON.stringify(c.state.db);const row=c.contactVals(c.x()).cd.detailRows.find(r=>r.k==='Imported last activity');
  assert.equal(row.v,'2026-09-10 14:32 · source time zone unknown');assert.equal(JSON.stringify(c.state.db),before);assert.equal(c.state.db.activity.length,0);
  delete c.state.db.contacts[0].source_last_activity;assert.ok(!c.contactVals(c.x()).cd.detailRows.some(r=>r.k==='Imported last activity'));
});
