import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {scopeSnapshot,mergeScopedWrite} from './user-access.mjs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const template=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const plain=value=>JSON.parse(JSON.stringify(value));
const sales=scope=>({id:'auth_sales',orgId:'org1',name:'Fictional Sales',email:'sales@example.invalid',isOwner:false,roleCode:'sales_associate',visibility:{profile:'sales_associate',scope,sections:['contacts','pipeline','calls'],editSections:['contacts','pipeline','calls']}});
function source(){return {org:{id:'org1'},users:[{id:'crm_sales',auth_user_id:'auth_sales',name:'Fictional Sales',email:'sales@example.invalid'},{id:'private_owner',name:'Hidden colleague',email:'hidden@example.invalid'}],user_prefs:{crm_sales:{}},checklists:{precall:[],onboarding:[]},contacts:[
 {id:'east',name:'Fictional Eastern lead',timezone:'America/New_York',status:'Contacted',owner_user_id:'crm_sales',services:[],tags:[]},
 {id:'arizona',name:'Fictional Arizona lead',timezone:'America/Phoenix',status:'Not contacted',assignees:[{user_id:'auth_sales'}],services:[],tags:[]},
 {id:'west',name:'Fictional Pacific lead',timezone:'America/Los_Angeles',status:'Contacted',owner:'Hidden colleague',services:[],tags:[]},
 {id:'unknown',name:'Fictional unknown lead',timezone:'',timezone_review:true,status:'Contacted',owner_user_id:'crm_sales',services:[],tags:[]},
 {id:'invalid',name:'Fictional invalid lead',timezone:'invalid/zone',timezone_review:true,status:'Not contacted',owner:'Hidden colleague',services:[],tags:[]},
 ],deals:[],todos:[],tickets:[],meetings:[],activity:[]};}
function fixture({scope='all_sales',owner=false,db=source()}={}){
 const auth=owner?{...sales(scope),isOwner:true}:sales(scope);
 const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,setTimeout:()=>0,clearTimeout(){},DCLogic:class{setState(value,cb){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};cb?.();}}};
 vm.createContext(context);vm.runInContext(code+';globalThis.FilterComponent=Component;',context);const c=new context.FilterComponent();c.props={};c.persistDb=()=>{};c.toast=()=>{};
 c.state={...c.state,authChecked:true,accessUser:auth,meId:'crm_sales',db:c.normalizeScopedWorkspace(scopeSnapshot(db,auth)),view:'contacts',fStatus:'All',fService:'All'};
 c.x=()=>({db:c.state.db,live:c.state.db.contacts.filter(c=>!c.deleted_at&&!c.archived_at),clients:[],byId:Object.fromEntries(c.state.db.contacts.map(c=>[c.id,c])),wStart:9,wEnd:17});
 return {c,auth,db};
}
const ids=c=>plain(c.contactsVals(c.x()).contactRows.map(c=>c.id));

test('timezone filters use saved valid zones and keep unknown records honest',()=>{
 const {c}=fixture(),before=JSON.stringify(c.state.db);let v=c.contactsVals(c.x());
 assert.ok(v.fTimezoneOpts.some(o=>o.v==='America/Phoenix'));assert.ok(v.fTimezoneOpts.some(o=>o.l==='Eastern'));
 v.onFTimezone({target:{value:'America/Phoenix'}});assert.deepEqual(ids(c),['arizona']);
 c.state.fTimezone='Unknown';assert.deepEqual(ids(c),['invalid','unknown']);assert.equal(JSON.stringify(c.state.db),before);
});

test('mine filter uses server assignment without exposing hidden colleague identities',()=>{
 const {c}=fixture();assert.equal(ids(c).length,5);c.contactsVals(c.x()).onFAssignment({target:{value:'mine'}});
 assert.deepEqual(ids(c),['arizona','east','unknown']);
 assert.doesNotMatch(JSON.stringify(c.state.db),/Hidden colleague|hidden@example.invalid|private_owner/);
 assert.deepEqual(plain(c.contactsVals(c.x()).fAssignmentOpts),[{v:'all',l:'All contacts'},{v:'mine',l:'Assigned to me'}]);
});

test('owner contact ownership and explicit assignments both qualify as mine',()=>{
 const {c}=fixture({owner:true});c.state.fAssignment='mine';assert.deepEqual(ids(c),['arizona','east','unknown']);
});

test('assignment and zone options stay within assigned-only access',()=>{
 const {c}=fixture({scope:'assigned'});assert.deepEqual(ids(c),['arizona','east','unknown']);
 assert.ok(!c.contactsVals(c.x()).fTimezoneOpts.some(o=>o.v==='America/Los_Angeles'));
 c.state.fAssignment='mine';assert.deepEqual(ids(c),['arizona','east','unknown']);
});

test('new filters compose with search and status before pagination and reset to first page',()=>{
 const {c}=fixture();c.state.contactPage=3;c.contactsVals(c.x()).onFAssignment({target:{value:'mine'}});assert.equal(c.state.contactPage,1);
 c.state.contactPage=3;c.contactsVals(c.x()).onFTimezone({target:{value:'America/New_York'}});assert.equal(c.state.contactPage,1);
 c.state.fStatus='Contacted';c.state.q='Eastern';assert.deepEqual(ids(c),['east']);
 c.state.fStatus='Not contacted';assert.deepEqual(ids(c),[]);assert.equal(c.contactsVals(c.x()).contactFiltered,true);
 c.contactsVals(c.x()).clearContactFilters();assert.equal(c.state.fAssignment,'all');assert.equal(c.state.fTimezone,'All');assert.equal(ids(c).length,5);
});

test('saved views restore both filters and older views reset them',()=>{
 const {c}=fixture({owner:true});c.state.fAssignment='mine';c.state.fTimezone='America/New_York';c.state.newViewName='Fictional Eastern assignments';c.contactsVals(c.x()).saveContactView();
 c.contactsVals(c.x()).clearContactFilters();c.contactsVals(c.x()).contactViews[0].apply();assert.deepEqual(ids(c),['east']);
 c.state.db.user_prefs.crm_sales.contactViews.push({id:'legacy',label:'Fictional old view',filters:{q:'Pacific'}});c.contactsVals(c.x()).contactViews.find(v=>v.id==='legacy').apply();
 assert.equal(c.state.fAssignment,'all');assert.equal(c.state.fTimezone,'All');assert.deepEqual(ids(c),['west']);
});

test('empty selection retains its label and distant-page matches remain discoverable',()=>{
 const db=source();db.contacts=Array.from({length:215},(_,i)=>({...db.contacts[0],id:'p'+i,name:'Fictional page '+String(i).padStart(3,'0'),timezone:i===214?'America/Phoenix':'America/New_York'}));
 const {c}=fixture({db});c.state.contactPage=3;c.contactsVals(c.x()).onFTimezone({target:{value:'America/Phoenix'}});assert.deepEqual(ids(c),['p214']);assert.equal(c.contactsVals(c.x()).contactRange,'Showing 1–1 of 1 matches');
 c.state.db.contacts=c.state.db.contacts.filter(c=>c.id!=='p214');const v=c.contactsVals(c.x());assert.equal(v.contactsEmpty,true);assert.ok(v.fTimezoneOpts.some(o=>o.v==='America/Phoenix'));
});

test('assignment projection is not editable and never widens server contact access',()=>{
 const {c,auth,db}=fixture();assert.ok(!c.salesContactFields().includes('assigned_to_me'));assert.ok(c.workspaceWritePayload().contacts.every(c=>!Object.hasOwn(c,'assigned_to_me')));
 const scoped=scopeSnapshot(db,auth);scoped.contacts.find(c=>c.id==='west').assigned_to_me=true;const merged=mergeScopedWrite(db,scoped,auth);
 assert.equal(merged.contacts.find(c=>c.id==='west').owner,'Hidden colleague');assert.ok(!Object.hasOwn(merged.contacts[0],'assigned_to_me'));
 assert.equal(scopeSnapshot(merged,auth).contacts.find(c=>c.id==='west').assigned_to_me,false);
 const restricted=sales('assigned');assert.ok(!scopeSnapshot(merged,restricted).contacts.some(c=>c.id==='west'));
});

test('duplicate flags normalize US phones and emails, skip blanks and archived contacts',()=>{
 const {c}=fixture();const records=[{id:'a',phone:'+1 (212) 555-0100',email:'Agent@Example.com'},{id:'b',phone:'2125550100'},{id:'c',email:' agent@example.com '},{id:'blank'},{id:'blank2'},{id:'gone',phone:'2125550100',archived_at:'yes'}];const result=c.duplicateContacts(records);assert.match(result.get('a'),/phone and email/);assert.match(result.get('b'),/phone/);assert.match(result.get('c'),/email/);assert.equal(result.size,3);
});
test('contact search matches formatted telephone, city and accent variants; duplicate filter clears',()=>{
 const {c}=fixture();c.state.db.contacts[0].phone='+1 (212) 555-0100';c.state.db.contacts[0].city='Montréal';c.state.db.contacts[1].phone='2125550100';c.state.q='2125550100';assert.deepEqual(ids(c),['arizona','east']);c.state.q='Montreal';assert.deepEqual(ids(c),['east']);c.state.q='';c.contactsVals(c.x()).onFDuplicates({target:{checked:true}});assert.deepEqual(ids(c),['arizona','east']);c.contactsVals(c.x()).clearContactFilters();assert.equal(ids(c).length,5);
});
test('sales global search includes permitted deals and calls, hides forbidden categories and navigates to call history',()=>{
 const {c}=fixture();const db=c.state.db;db.deals=[{id:'d',contact_id:'east',stage:'Discovery',scope_agreed:'needle'}];db.calls=[{id:'k',contact_id:'east',outcome:'Connected',note:'needle'}];db.notes=[{entity_id:'east',entity_type:'contact',body:'needle hidden'}];db.files=[{contact_id:'east',name:'needle hidden'}];const groups=c.workspaceSearch(db,db.contacts,'needle');assert.deepEqual(plain(groups.map(g=>g.label)),['Deals (1)','Calls (1)']);c.openContact=(id,tab)=>{c.opened={id,tab};};groups[1].items[0].go();assert.deepEqual(c.opened,{id:'east',tab:'calllog'});c.state.accessUser.visibility.sections=['contacts'];assert.equal(c.workspaceSearch(db,db.contacts,'needle').length,0);
});
test('contact manual log is available to permitted staff without initiating a phone call',()=>{
 const {c}=fixture();c.state.contactId='east';c.state.db.contacts[0].phone='2125550100';const v=c.contactVals(c.x()).cd;assert.equal(v.canLogCall,true);let opened;c.endCallDialog=(id,phone)=>{opened={id,phone};};v.logCall();assert.deepEqual(opened,{id:'east',phone:'2125550100'});c.state.accessUser.visibility.editSections=['contacts'];assert.equal(c.contactVals(c.x()).cd.canLogCall,false);
});
