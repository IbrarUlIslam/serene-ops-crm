import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const raw=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const template=JSON.parse(raw.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
function fixture(){
  const context={Date,Intl,JSON,Math,URL,console,setTimeout:()=>0,clearTimeout(){},DCLogic:class{setState(value){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};}}};
  vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);
  const c=new context.ReviewComponent();c.state={...c.state,authChecked:true,accessUser:{id:'owner',email:'owner@example.test',isOwner:true},meIdUnresolved:false,dbLoadFailed:false,db:{contacts:[{id:'original',name:'Existing contact'}],files:[{id:'manual',name:'Manual document'}]}};
  c._saveEpoch=2;c._savedEpoch=2;c._snapshotEtag='"old"';c.toast=()=>{};
  const next={contacts:[{id:'sample',name:'Sample fictional contact'}],files:[{id:'report',audit_report_id:'r1'}]};
  let resolve;c.apiFetch=()=>new Promise(done=>{resolve=done;});
  return{c,next,complete:()=>resolve({ok:true,json:async()=>({data:next,updatedAt:'new'}),headers:{get:()=>null}})};
}
test('white workspace uses white surfaces and keeps the brand/status palette',()=>{
  assert.equal(/#(?:fdf6e3|fffaf0|fffdfa)/i.test(template),false);assert.match(template,/--paper:#FFFFFF/);assert.match(template,/#00B4D2/);assert.match(template,/#A4453A/);assert.doesNotThrow(()=>new vm.Script(code));
});
test('clean audit document refresh adopts the sample contact and matching server revision',async()=>{
  const {c,next,complete}=fixture();const pending=c.refreshAuditDocuments();complete();await pending;
  assert.equal(c.state.db,next);assert.equal(c.state.db.contacts[0].id,'sample');assert.equal(c._snapshotEtag,'"new"');assert.equal(c._saveEpoch,2);
});
test('audit refresh preserves edits made after its read started and merges only generated files',async()=>{
  const {c,complete}=fixture();const before=c.state.db,pending=c.refreshAuditDocuments();before.contacts[0].name='Unsaved new name';c._saveEpoch=3;complete();await pending;
  assert.equal(c.state.db.contacts,before.contacts);assert.equal(c.state.db.contacts[0].name,'Unsaved new name');assert.equal(c._snapshotEtag,'"old"');assert.deepEqual(Array.from(c.state.db.files,f=>f.id),['manual','report']);
});
test('a save completed during an audit read cannot be replaced by its older snapshot',async()=>{
  const {c,complete}=fixture();const pending=c.refreshAuditDocuments();c.state.db.contacts[0].name='Just saved';c._saveEpoch=3;c._savedEpoch=3;c._snapshotEtag='"latest-save"';complete();await pending;
  assert.equal(c.state.db.contacts[0].name,'Just saved');assert.equal(c._snapshotEtag,'"latest-save"');
});
test('audit document replies cannot restore private cached records after access changes',async()=>{
  for(const revoke of [true,false]){const {c,complete}=fixture();const pending=c.refreshAuditDocuments();if(revoke){c.state.db=null;c.state.accessUser=null;}else c.state.accessUser={id:'other',email:'other@example.test',isOwner:true};complete();await pending;
    assert.equal(c._snapshotEtag,'"old"');assert.ok(!c.state.db||c.state.db.contacts[0].id==='original');}
});
