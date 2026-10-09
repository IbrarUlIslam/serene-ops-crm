import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleContactArchive,canArchiveContact} from './contact-archive.mjs';
import {encodeSnapshot,decodeSnapshot,SNAPSHOT_GZIP_PREFIX} from './snapshot-codec.mjs';
import {canAccessSalesContact,canAccessSalesDeal,scopeSnapshot,mergeScopedWrite} from './user-access.mjs';
import {buildCallQueue} from './call-queue.mjs';

const sales=(scope='all_sales',sections=['contacts','pipeline','calls'],editSections=sections)=>({id:'u_sales',orgId:'org1',name:'Fictional Sales',email:'sales@example.test',isOwner:false,roleCode:'sales_associate',visibility:{profile:'sales_associate',scope,sections,editSections}});
const owner={id:'u_ibrar',orgId:'org1',name:'Fictional Owner',email:'owner@example.test',isOwner:true};
const source=()=>({users:[{id:'u_sales',name:'Fictional Sales',email:'sales@example.test'}],contacts:[{id:'lead',name:'Fictional Realtor',status:'Not contacted',phone:'+12125551234',timezone:'America/New_York',tz_source:'manual',owner_user_id:'someone_else',notes:'Private retained notes',monthly_override:900},{id:'mine',name:'Assigned Realtor',status:'Not contacted',owner_user_id:'u_sales',timezone:'America/New_York'}],deals:[{id:'deal',contact_id:'lead',stage:'Demo scheduled',scope_agreed:'Private retained contract'}],todos:[{id:'task',contact_id:'lead',assignee:'Fictional Owner',title:'Pending private operation',status:'Open'}],files:[{id:'file',contact_id:'lead',name:'Private retained file'}],calls:[{id:'call',contact_id:'lead',at:'2026-10-01T12:00:00Z',outcome:'No answer'}],notes:[],activity:[],archive_items:[],org:{name:'Serene Ops'},user_prefs:{}});
const request=(body={contactId:'lead',reason:'Not interested; asked us to close the sales record.'},version='2026-10-08T12:00:00.000Z',method='POST')=>new Request('https://crm.test/api/contact-archive',{method,headers:version?{'If-Match':JSON.stringify(version)}:{},body:method==='POST'?JSON.stringify(body):undefined});
async function fixture(db=source()){
 const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);CREATE TABLE users(id TEXT,org_id TEXT,name TEXT,email TEXT,role_id TEXT,status TEXT,deleted_at TEXT,created_at TEXT);INSERT INTO users VALUES('u_sales','org1','Fictional Sales','sales@example.test','role_contributor','active',NULL,'2026-01-01');");
 sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',await encodeSnapshot(JSON.stringify(db)),'2026-10-08T12:00:00.000Z','u_ibrar');
 const wrap=(query,values=[])=>({first:async()=>query.get(...values)||null,all:async()=>({results:query.all(...values)}),run:async()=>({meta:{changes:Number(query.run(...values).changes)}})});
 return {sql,env:{DB:{prepare(text){const query=sql.prepare(text);return {...wrap(query),bind(...values){return wrap(query,values);}};}}},read:async()=>decodeSnapshot(sql.prepare('SELECT data FROM crm_snapshot WHERE org_id=?').get('org1').data)};
}

test('sales archive requires a reason, records canonical actor/time, and preserves linked private data',async()=>{
 const initial=source(),f=await fixture(initial);try{const result=await handleContactArchive(request({contactId:'lead',reason:'  Not interested.  '}),f.env,sales());assert.equal(result.status,200);const body=await result.json(),stored=await f.read(),row=stored.contacts[0];assert.equal(row.archive_reason,'Not interested.');assert.equal(row.archived_by,'Fictional Sales');assert.equal(row.archived_by_user_id,'u_sales');assert.ok(Number.isFinite(Date.parse(row.deleted_at)));assert.deepEqual(row.archive_history,[{action:'Archived',at:row.deleted_at,by:'Fictional Sales',by_user_id:'u_sales',reason:'Not interested.'}]);assert.equal(row.notes,initial.contacts[0].notes);assert.equal(row.monthly_override,900);for(const field of ['deals','todos','files','calls','archive_items'])assert.deepEqual(stored[field],initial[field]);assert.equal(stored.activity[0].by_user_id,'u_sales');assert.equal(stored.activity[0].contact_id,'lead');assert.match(stored.activity[0].what,/Not interested/);assert.equal(body.snapshot,undefined);const scoped=scopeSnapshot(stored,sales());assert.deepEqual(scoped.contacts.map(c=>c.id),['mine']);assert.equal(scoped.deals.length,0);assert.equal(JSON.stringify(scoped).includes('Private retained'),false);assert.equal(result.headers.get('ETag'),JSON.stringify(body.updatedAt));assert.equal(f.sql.prepare('SELECT updated_by FROM crm_snapshot').get().updated_by,'u_sales');}finally{f.sql.close();}
});

test('empty, malformed, oversized and forged archive requests never change the workspace',async()=>{
 const f=await fixture();try{for(const body of [{contactId:'lead',reason:''},{contactId:'lead',reason:'  \n  '},{contactId:'lead',reason:null},{contactId:'lead',reason:'x'.repeat(2001)},{contactId:'../lead',reason:'Reason'},{contactId:'lead',reason:'Reason',by:'Fictional Owner'},{contactId:'lead',reason:'Reason',deleted_at:'2000-01-01'},null,[]])assert.equal((await handleContactArchive(request(body),f.env,sales())).status,400);assert.equal((await handleContactArchive(new Request('https://crm.test/api/contact-archive',{method:'POST',body:'{bad'}),f.env,sales())).status,400);assert.equal((await handleContactArchive(request({contactId:'lead',reason:'x'.repeat(6000)}),f.env,sales())).status,413);assert.equal((await f.read()).contacts[0].deleted_at,undefined);}finally{f.sql.close();}
});

test('read-only, removed sections, assigned scope and ordinary contributors cannot bypass archive permissions',async()=>{
 const f=await fixture();try{for(const user of [sales('all_sales',['contacts'],[]),sales('all_sales',['calls'],['calls']),{...sales(),roleCode:'contributor',visibility:{...sales().visibility,profile:'contributor'}}]){assert.equal(canArchiveContact(user),false);assert.equal((await handleContactArchive(request(),f.env,user)).status,403);}assert.equal((await handleContactArchive(request(),f.env,sales('assigned'))).status,403);assert.equal((await handleContactArchive(request({contactId:'mine',reason:'No longer available'}),f.env,sales('assigned'))).status,200);assert.equal((await f.read()).contacts[0].deleted_at,undefined);}finally{f.sql.close();}
});

test('unknown, already archived and cross-organization records fail without revealing their identity',async()=>{
 const db=source();db.contacts.push({id:'other_org',org_id:'org2',name:'Outside identity',status:'Not contacted'},{id:'archived',name:'Archived identity',status:'Not contacted',deleted_at:'2026-10-01'});const f=await fixture(db);try{for(const contactId of ['unknown','other_org','archived']){const result=await handleContactArchive(request({contactId,reason:'Reason'}),f.env,sales());assert.equal(result.status,403);assert.equal((await result.text()).includes('identity'),false);}assert.deepEqual(await f.read(),db);}finally{f.sql.close();}
});

test('missing and stale revisions preserve pending changes; a competing write wins the conditional save',async()=>{
 const f=await fixture();try{assert.equal((await handleContactArchive(request(undefined,null),f.env,sales())).status,428);assert.equal((await handleContactArchive(request(undefined,'stale'),f.env,sales())).status,409);const prepare=f.env.DB.prepare.bind(f.env.DB);f.env.DB.prepare=text=>{const statement=prepare(text);if(!text.startsWith('UPDATE crm_snapshot'))return statement;const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),run=bound.run;bound.run=async()=>{f.sql.prepare('UPDATE crm_snapshot SET updated_at=?').run('2026-10-08T12:00:01.000Z');return run();};return bound;};return statement;};assert.equal((await handleContactArchive(request(),f.env,sales())).status,409);assert.equal((await f.read()).contacts[0].deleted_at,undefined);}finally{f.sql.close();}
});

test('archive continues using compressed snapshot storage for large imported workspaces',async()=>{
 const db=source();db.original_notes='Fictional source reference data. '.repeat(45000);const f=await fixture(db);try{assert.equal((await handleContactArchive(request(),f.env,sales())).status,200);assert.ok(f.sql.prepare('SELECT data FROM crm_snapshot').get().data.startsWith(SNAPSHOT_GZIP_PREFIX));assert.equal((await f.read()).original_notes,db.original_notes);}finally{f.sql.close();}
});

test('archived contacts leave calling and sales deals; restored contacts retain their archive evidence',async()=>{
 const f=await fixture();try{assert.equal((await handleContactArchive(request(),f.env,sales())).status,200);const db=await f.read(),contact=db.contacts[0];assert.equal(canAccessSalesContact(contact,db,sales()),false);assert.equal(canAccessSalesDeal(db.deals[0],db,sales()),false);const queue=buildCallQueue(db,sales(),new Date('2026-10-08T16:00:00Z'));assert.equal(JSON.stringify(queue).includes('Fictional Realtor'),false);const evidence=structuredClone(contact.archive_history);contact.deleted_at=null;assert.equal(canAccessSalesContact(contact,db,sales()),true);assert.deepEqual(contact.archive_history,evidence);const scoped=scopeSnapshot(db,sales());assert.equal(JSON.stringify(scoped).includes('archive_reason'),false);assert.throws(()=>mergeScopedWrite(db,{contacts:[{id:'lead',archive_reason:'Erase audit evidence'}]},sales()),/Sales cannot/);}finally{f.sql.close();}
});

test('owner sees archive reason and can archive without receiving destructive cascade permissions',async()=>{
 const f=await fixture();try{assert.equal((await handleContactArchive(request(),f.env,owner)).status,200);const db=await f.read();assert.equal(scopeSnapshot(db,owner).contacts[0].archive_reason,'Not interested; asked us to close the sales record.');assert.equal(db.todos[0].status,'Open');assert.equal(db.archive_items.length,0);assert.equal((await handleContactArchive(request(undefined,undefined,'GET'),f.env,owner)).status,405);}finally{f.sql.close();}
});
