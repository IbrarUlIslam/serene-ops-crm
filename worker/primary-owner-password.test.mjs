import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleAuthRequest} from './worker.js';
function fixture(primary='u_ibrar'){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE users(id TEXT PRIMARY KEY,org_id TEXT,password_hash TEXT,password_algo TEXT,password_set_at TEXT,deleted_at TEXT);CREATE TABLE activity_log(id TEXT,org_id TEXT,who_user_id TEXT,what TEXT,contact_id TEXT);');sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(primary,'org1','keep-primary-password','pbkdf2-sha256',null,null);sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('staff','org1','old-staff-password','pbkdf2-sha256',null,null);
 const wrap=(statement,values=[])=>({first:async()=>statement.get(...values)||null,run:async()=>({meta:{changes:Number(statement.run(...values).changes)}})});return{sql,env:{CRM_OWNER_USER_ID:primary,DB:{prepare(text){const statement=sql.prepare(text);return{...wrap(statement),bind(...values){return wrap(statement,values);}};}}}};
}
const actor=(id='secondary_admin')=>({id,orgId:'org1',name:'Fictional Admin',roleCode:id==='u_ibrar'?'owner_admin':'crm_admin',isOwner:true,isPrimaryOwner:true,permissions:new Set()});
const request=id=>new Request('https://crm.test/api/auth/admin-set-password',{method:'POST',body:JSON.stringify({userId:id,password:'a-long-fictional-password'})});
test('secondary administrators cannot reset the primary owner password even with a forged owner flag',async()=>{
 for(const primary of ['u_ibrar','configured_primary']){const f=fixture(primary);try{const response=await handleAuthRequest(request(primary),f.env,actor(),'admin-set-password');assert.equal(response.status,403);assert.equal(f.sql.prepare('SELECT password_hash FROM users WHERE id=?').get(primary).password_hash,'keep-primary-password');assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM activity_log').get().n,0);}finally{f.sql.close();}}
});
test('primary id without the protected owner role cannot reset the primary password',async()=>{
 const f=fixture();try{assert.equal((await handleAuthRequest(request('u_ibrar'),f.env,{...actor('u_ibrar'),roleCode:'crm_admin'},'admin-set-password')).status,403);assert.equal(f.sql.prepare('SELECT password_hash FROM users WHERE id=?').get('u_ibrar').password_hash,'keep-primary-password');}finally{f.sql.close();}
});
test('secondary administrators can reset ordinary same-organization users without touching the primary account',async()=>{
 const f=fixture();try{assert.equal((await handleAuthRequest(request('staff'),f.env,actor(),'admin-set-password')).status,200);assert.notEqual(f.sql.prepare('SELECT password_hash FROM users WHERE id=?').get('staff').password_hash,'old-staff-password');assert.equal(f.sql.prepare('SELECT password_hash FROM users WHERE id=?').get('u_ibrar').password_hash,'keep-primary-password');assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM activity_log').get().n,1);}finally{f.sql.close();}
});
