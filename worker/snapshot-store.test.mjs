import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {snapshotEtag,checkSnapshotRevision,writeSnapshot} from './snapshot-store.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);');
  const wrap = (s,v=[])=>({first:async()=>s.get(...v)||null,run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
  const env = {DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};
  return {sql,env};
}

test('snapshot reads produce exact tokens and saving requires a matching version',()=>{
  const row={updated_at:'2026-10-07T01:00:00.000Z'};
  const req=(value)=>new Request('https://crm.test/api/db',{method:'PUT',headers:value?{'If-Match':value}:{}});
  assert.equal(snapshotEtag(null),'"empty"');
  assert.equal(checkSnapshotRevision(req(null),row).status,428);
  assert.equal(checkSnapshotRevision(req('"stale"'),row).status,409);
  assert.equal(checkSnapshotRevision(req(snapshotEtag(row)),row),null);
});

test('two owner tabs cannot replace a newer snapshot with stale data',async()=>{
  const f=fixture();try{
    const first=await writeSnapshot(f.env,'org1','{"todos":[{"status":"Open"}]}','owner',null);
    const previous=f.sql.prepare('SELECT * FROM crm_snapshot WHERE org_id=?').get('org1');
    assert.equal(previous.updated_at,first);
    const fresh=await writeSnapshot(f.env,'org1','{"todos":[{"status":"Done"}]}','staff',previous);
    assert.ok(fresh);assert.notEqual(fresh,first);
    assert.equal(await writeSnapshot(f.env,'org1','{"todos":[{"status":"Open"}]}','owner',previous),null);
    assert.equal(JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot WHERE org_id=?').get('org1').data).todos[0].status,'Done');
  }finally{f.sql.close();}
});

test('first-save races do not overwrite a created workspace or another organization',async()=>{
  const f=fixture();try{
    assert.ok(await writeSnapshot(f.env,'org1','first','owner',null));
    assert.equal(await writeSnapshot(f.env,'org1','stale-create','owner',null),null);
    assert.ok(await writeSnapshot(f.env,'org2','other','other',null));
    assert.equal(f.sql.prepare('SELECT data FROM crm_snapshot WHERE org_id=?').get('org1').data,'first');
  }finally{f.sql.close();}
});
