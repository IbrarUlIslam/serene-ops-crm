import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixNativeSelectBundle,runtimeId}=require('./fix-native-selects.cjs');
const original=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fixed=fixNativeSelectBundle(original);
const decode=(html,name)=>JSON.parse(html.match(new RegExp('<script type="__bundler/'+name+'">([\\s\\S]*?)<\\/script>'))[1]);
const template=decode(fixed,'template'),manifest=decode(fixed,'manifest');
const runtime=zlib.gunzipSync(Buffer.from(manifest[runtimeId].data,'base64')).toString('utf8');

test('native option wrappers survive the first parse and unwrap only during scoped rendering',()=>{
  const markup=template.slice(0,template.indexOf('<script type="text/x-dc"'));
  assert.ok(markup.includes('<sc-raw-option'));
  assert.ok(!/<\/?option(?=[\s>])/i.test(markup));
  assert.match(runtime,/option: "sc-raw-option"/);assert.match(runtime,/optgroup: "sc-raw-optgroup"/);
  assert.match(runtime,/RAW_UNWRAP\[el\.localName\]/);
  assert.doesNotThrow(()=>new vm.Script(runtime));
});

test('every option loop and change handler is retained',()=>{
  const before=decode(original,'template');
  assert.equal((template.match(/<sc-for\b/g)||[]).length,(before.match(/<sc-for\b/g)||[]).length);
  assert.equal((template.match(/sc-camel-on-change=/g)||[]).length,(before.match(/sc-camel-on-change=/g)||[]).length);
  assert.equal((template.match(/<sc-raw-select\b/g)||[]).length,(before.match(/<sc-raw-select\b/g)||[]).length);
  assert.ok(template.includes('<sc-raw-option value="{{ o }}">{{ o }}</sc-raw-option>'));
  assert.ok(template.includes('<sc-raw-option value="{{ o.v }}">{{ o.l }}</sc-raw-option>'));
});

test('contact status options match object label/value bindings',()=>{
  const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(()=>new vm.Script(code));
  assert.match(code,/statusOpts:\['All'\]\.concat\(this\.CSTAT\)\.map\(v=>\(\{v,l:v==='All'\?'All statuses':v\}\)\)/);
});

test('select repair is repeat-safe and touches no other manifest resource',()=>{
  assert.equal(fixNativeSelectBundle(fixed),fixed);
  const previous=decode(original,'manifest');
  for(const [name,value]of Object.entries(previous))if(name!==runtimeId)assert.deepEqual(manifest[name],value);
});
