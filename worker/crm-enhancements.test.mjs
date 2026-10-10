import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {enforceContactIntegrity,contactKeys} from './contact-integrity.mjs';
import {senderAddresses,chooseSender} from './mail-senders.mjs';
import {handleContactNotes} from './contact-notes.mjs';
import {writeSnapshot} from './snapshot-store.mjs';
import {decodeSnapshot} from './snapshot-codec.mjs';
import {handleCallHistory} from './call-history.mjs';
import {scopeSnapshot} from './user-access.mjs';

const admin={id:'admin',orgId:'org1',name:'Admin',isOwner:true};
const sales={id:'sales',orgId:'org1',name:'Sales',email:'sales@example.invalid',isOwner:false,roleCode:'sales_associate',visibility:{profile:'sales_associate',scope:'assigned',sections:['contacts','calls'],editSections:['contacts','calls']}};
const source=()=>({users:[{id:'sales',auth_user_id:'sales',name:'Sales',email:sales.email},{id:'admin',auth_user_id:'admin',name:'Admin',role:'Owner / Admin'}],contacts:[{id:'mine',name:'Assigned',owner_user_id:'sales',status:'Contacted',phone:'+12025550111'},{id:'other',name:'Other',owner_user_id:'admin',status:'Client',email:'other@example.invalid'}],notes:[],calls:[],deals:[]});
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);');const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});return{sql,env:{DB:{prepare(q){const s=sql.prepare(q);return{...wrap(s),bind(...v){return wrap(s,v);}};}}}};}
const note=(body)=>new Request('https://crm.example.invalid/api/contact-notes',{method:'POST',body:JSON.stringify({key:'test-note',contactId:'mine',body:'Call preparation',...body})});

test('duplicate identities normalize US numbers, extensions, whitespace and email case',()=>{
 assert.deepEqual(contactKeys({phone:'+1 (202) 555-0111 ext. 12',email:' TEST@example.invalid '}),['phone:2025550111','email:test@example.invalid']);
 const before=source(),db=structuredClone(before);db.contacts.push({id:'new',phone:'202-555-0111'});assert.throws(()=>enforceContactIntegrity(db,before),e=>e.code==='DUPLICATE_CONTACT'&&e.status===409);
});
test('duplicate prevention includes archived records and email changes',()=>{
 const before=source();before.contacts[1].archived_at='2026-10-01';const db=structuredClone(before);db.contacts[0].email=' OTHER@example.invalid ';assert.throws(()=>enforceContactIntegrity(db,before),/already exists/);
});
test('existing duplicate flags do not block unrelated notes or treat equal names as duplicates',()=>{
 const before=source();before.contacts.push({...before.contacts[0],id:'legacy'});const db=structuredClone(before);db.contacts[0].sales_notes='New context';assert.doesNotThrow(()=>enforceContactIntegrity(db,before));
 const fresh=source();fresh.contacts.push({id:'distinct',name:fresh.contacts[0].name,phone:'+12025550112'});assert.doesNotThrow(()=>enforceContactIntegrity(fresh,source()));
});
test('DNC status blocks calling and client ownership gains a canonical administrator ID',()=>{
 const db=source();db.contacts[0].status='DNC';delete db.contacts[1].owner_user_id;enforceContactIntegrity(db,source());assert.equal(db.contacts[0].do_not_call,true);assert.ok(db.contacts[0].do_not_call_at);assert.equal(db.contacts[1].owner_user_id,'admin');
});
test('two contact creation attempts cannot overwrite one another and a refreshed duplicate is rejected',async()=>{
 const f=fixture();try{const db=source();await writeSnapshot(f.env,'org1',db,admin.id,null);const previous=f.sql.prepare('SELECT * FROM crm_snapshot').get();const one=structuredClone(db);one.contacts.push({id:'one',email:'new@example.invalid'});assert.ok(await writeSnapshot(f.env,'org1',one,admin.id,previous));const two=structuredClone(db);two.contacts.push({id:'two',email:'NEW@example.invalid'});assert.equal(await writeSnapshot(f.env,'org1',two,admin.id,previous),null);const latest=f.sql.prepare('SELECT * FROM crm_snapshot').get(),current=await decodeSnapshot(latest.data);current.contacts.push(two.contacts.at(-1));await assert.rejects(writeSnapshot(f.env,'org1',current,admin.id,latest),/already exists/);}finally{f.sql.close();}
});
test('From choices include confirmed mailbox aliases and validated external senders but reject disabled and unverified senders',()=>{
 const choices=senderAddresses({emailAddress:[{mailId:'alias@example.invalid',isAlias:true,isConfirmed:true},{mailId:'disabled@example.invalid',isConfirmed:true},{mailId:'pending@example.invalid',isConfirmed:false}],sendMailDetails:[{fromAddress:'external@example.invalid',status:true,validated:true},{fromAddress:'disabled@example.invalid',status:false,validated:true},{fromAddress:'pending@example.invalid',status:true,validated:false,validationRequired:true}]},'main@example.invalid');
 assert.deepEqual(choices,['main@example.invalid','alias@example.invalid','external@example.invalid']);assert.equal(chooseSender(' ALIAS@example.invalid ',choices,'main@example.invalid'),'alias@example.invalid');assert.throws(()=>chooseSender('stranger@example.invalid',choices,'main@example.invalid'),/authorized From/);
});
test('assigned sales can append and retry a note without duplicate entries or replacing other notes',async()=>{
 const f=fixture();try{const db=source();db.calls=[{id:'call',contact_id:'mine',by_user_id:sales.id,queue:'next_to_call',note:'A previous call',at:'2026-10-01T12:00:00Z'}];db.notes.push({id:'existing',entity_type:'contact',entity_id:'mine',body:'Prior team context',by:'Admin',at:'2026-10-01T12:00:00Z'});await writeSnapshot(f.env,'org1',db,admin.id,null);assert.equal((await handleContactNotes(note(),f.env,sales)).status,200);assert.equal((await(await handleContactNotes(note(),f.env,sales)).json()).duplicate,true);const saved=await decodeSnapshot(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(saved.notes.length,2);assert.equal(saved.notes[0].by_user_id,sales.id);assert.equal(saved.notes[1].body,'Prior team context');const scoped=scopeSnapshot(saved,sales);assert.deepEqual(scoped.notes.map(n=>n.by),['You','Team note']);assert.equal(scoped.calls[0].note,'A previous call');}finally{f.sql.close();}
});
test('notes reject unassigned contacts, read-only sales and unsafe URLs',async()=>{
 const f=fixture();try{await writeSnapshot(f.env,'org1',source(),admin.id,null);assert.equal((await handleContactNotes(note({contactId:'other'}),f.env,sales)).status,403);assert.equal((await handleContactNotes(note(),f.env,{...sales,visibility:{...sales.visibility,editSections:[]}})).status,403);assert.equal((await handleContactNotes(note({url:'javascript:alert(1)'}),f.env,sales)).status,400);assert.equal((await decodeSnapshot(f.sql.prepare('SELECT data FROM crm_snapshot').get().data)).notes.length,0);}finally{f.sql.close();}
});
test('administrators retain all assigned contacts while staff see their own assigned contacts only',()=>{
 const db=source();assert.deepEqual(scopeSnapshot(db,admin).contacts.map(c=>c.id),['mine','other']);assert.deepEqual(scopeSnapshot(db,sales).contacts.map(c=>c.id),['mine']);
});

test('complete call reporting reads more than the paginated list while preserving organization and admin access',async()=>{
 const f=fixture();try{f.sql.exec('CREATE TABLE zoom_calls(org_id TEXT,zoom_call_id TEXT,contact_id TEXT,initiated_by TEXT,created_at TEXT,updated_at TEXT,duration_seconds INTEGER);');const at=new Date().toISOString(),insert=f.sql.prepare('INSERT INTO zoom_calls VALUES(?,?,?,?,?,?,?)');for(let i=0;i<225;i++)insert.run('org1','z'+i,'mine','sales',at,at,60);insert.run('otherOrg','private','other','other',at,at,60);const req=days=>new Request('https://crm.example.invalid/api/calls/history?days='+days);const data=await(await handleCallHistory(req(7),f.env,admin)).json();assert.equal(data.data.calls.length,225);assert.ok(data.data.calls.every(c=>c.contact_id==='mine'));assert.equal((await handleCallHistory(req(7),f.env,sales)).status,403);assert.equal((await handleCallHistory(req(90),f.env,admin)).status,400);}finally{f.sql.close();}
});

test('repeated contact IDs cannot bypass duplicate checks',()=>{const db=source();db.contacts.push({...db.contacts[0]});assert.throws(()=>enforceContactIntegrity(db,source()),e=>e.code==='DUPLICATE_CONTACT');});
