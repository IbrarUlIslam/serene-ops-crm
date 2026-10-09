import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{removeInterfaceIcons}=require('./remove-interface-icons.cjs');
const raw=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const original=JSON.parse(raw.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const result=removeInterfaceIcons(original),scriptStart=result.indexOf('<script type="text/x-dc"'),markup=result.slice(0,scriptStart),code=result.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];

test('ordinary interface icons are restored while animal avatars remain removed',()=>{
  assert.equal(/<svg\b/i.test(markup),true);assert.match(code,/AVATAR = \{\};/);assert.match(code,/Interface icons and ticket board v1/);assert.match(markup,/data-ui-icon="navigation"/);assert.equal(/\p{Extended_Pictographic}/u.test(result),false);assert.equal(code.includes('M9.2 10.5C8.2'),false);
});

test('brand logo and native checkbox controls are preserved',()=>{
  assert.match(markup,/class="brand-mark"[^>]*aria-label="Serene Ops logo"/);assert.equal((markup.match(/type="checkbox"/g)||[]).length,(original.slice(0,original.indexOf('<script type="text/x-dc"')).match(/type="checkbox"/g)||[]).length);
});

test('all icon-only actions receive useful visible text',()=>{
  for(const [binding,label]of [['toggleDialer','Dialer'],['toggleBell','Notifications'],['dialBack','Delete last digit'],['calPrev','Previous'],['calNext','Next'],['t.up','Move up'],['t.down','Move down']]){
    const escaped=binding.replace(/\./g,'\\.'),button=markup.match(new RegExp('<button\\b[^>]*sc-camel-on-click="\\{\\{ '+escaped+' \\}\\}"[^>]*>([\\s\\S]*?)<\\/button>'));
    assert.ok(button,binding);assert.ok(button[1].includes(label),binding);
  }
  assert.equal(/<button\b[^>]*>\s*[←→↑↓×✕▸▾]\s*<\/button>/.test(markup),false);
});

test('closing controls retain descriptive labels and compact agenda opens details',()=>{
  for(const [binding,label]of [['mt.close','Close'],['dw.close','Close']]){
    const button=markup.match(new RegExp('<button\\b[^>]*sc-camel-on-click="\\{\\{ '+binding.replace(/\./g,'\\.')+' \\}\\}"[^>]*>([\\s\\S]*?)<\\/button>'));assert.ok(button?.[1].includes(label),binding);
  }
  assert.match(markup,/<button[^>]*sc-camel-on-click="\{\{ a.go \}\}"[^>]*class="command-agenda-row"/);
  const command=markup.slice(markup.indexOf('<sc-if value="{{ vToday }}">'),markup.indexOf('<sc-if value="{{ vMeet }}">'));
  assert.equal(/sc-camel-on-click="\{\{ [mr]\.remove \}\}"/.test(command),false);
});

test('accordion and performance labels use words and text buttons have room',()=>{
  assert.match(code,/chev:collapsed\?'Show':'Hide'/);assert.match(code,/toggleLabel:expanded\[tp\.id\]\?'Hide details':'View details'/);assert.match(code,/trend<=0\?'Decrease ':'Increase '/);assert.match(code,/width:auto;min-width:64px;height:38px;padding:0 12px/);
});

test('native script compiles and transformation is repeat-safe',()=>{
  assert.doesNotThrow(()=>new vm.Script(code));assert.equal(removeInterfaceIcons(result),result);
});

test('unrecognized SVGs are preserved for review instead of deleting data charts',()=>{
  const chart=original.replace('// Text-only interface controls v1.','').replace('<x-dc>','<x-dc><svg viewBox="0 0 800 400"><path d="M0 0"></path></svg>');assert.throws(()=>removeInterfaceIcons(chart),/Unexpected SVG/);
});

test('binding actions are unchanged by decoration removal',()=>{
  const originalMarkup=original.slice(0,original.indexOf('<script type="text/x-dc"'));const clicks=s=>[...s.matchAll(/sc-camel-on-click="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(clicks(markup),clicks(originalMarkup));
});
