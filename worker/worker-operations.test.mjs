import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleResourceRequest,handleAuthRequest} from './worker.js';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE contacts(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,updated_at TEXT,deleted_at TEXT);INSERT INTO contacts VALUES('mine','org1','Assigned record',NULL,NULL),('other','org2','Other record',NULL,NULL);CREATE TABLE users(id TEXT PRIMARY KEY,org_id TEXT,password_hash TEXT,deleted_at TEXT);INSERT INTO users VALUES('other-user','org2','keep-me',NULL);CREATE TABLE activity_log(id TEXT,org_id TEXT,who_user_id TEXT,what TEXT,contact_id TEXT);");const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});return {sql,env:{DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}}};}
const owner={id:'u_ibrar',orgId:'org1',isOwner:true,permissions:new Set()};
test('resource writes and deletes never cross the authenticated organization',async()=>{const f=fixture();try{
 const req=(method)=>new Request('https://crm.test/api/contacts/other',{method,body:method==='PATCH'?'{"name":"changed"}':undefined});
 assert.equal((await handleResourceRequest(req('PATCH'),f.env,owner,'contacts','other')).status,404);
 assert.equal((await handleResourceRequest(req('DELETE'),f.env,owner,'contacts','other')).status,404);
 assert.deepEqual({...f.sql.prepare('SELECT name,deleted_at FROM contacts WHERE id=?').get('other')},{name:'Other record',deleted_at:null});
 assert.equal((await handleResourceRequest(req('PATCH'),f.env,owner,'contacts','mine')).status,200);
 assert.equal(f.sql.prepare('SELECT name FROM contacts WHERE id=?').get('mine').name,'changed');
 }finally{f.sql.close();}});
test('administrator password reset cannot affect a different organization',async()=>{const f=fixture();try{
 const req=new Request('https://crm.test/api/auth/admin-set-password',{method:'POST',body:'{"userId":"other-user","password":"a-long-test-password"}'});
 assert.equal((await handleAuthRequest(req,f.env,owner,'admin-set-password')).status,404);
 assert.equal(f.sql.prepare('SELECT password_hash FROM users WHERE id=?').get('other-user').password_hash,'keep-me');
 }finally{f.sql.close();}});
