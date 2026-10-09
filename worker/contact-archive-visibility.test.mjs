import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {repairContactArchiveVisibility}=createRequire(import.meta.url)('./fix-contact-archive-visibility.cjs');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),raw=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]),template=repairContactArchiveVisibility(raw);
function ancestors(action){const stack=[];for(const item of template.matchAll(/<sc-if\b[^>]*>|<\/sc-if>|<button\b[^>]*sc-camel-on-click="\{\{ (?:cd\.remove|openPrice) \}\}"[^>]*>/g)){const tag=item[0];if(tag.startsWith('<sc-if'))stack.push(tag.match(/value=['"]\{\{\s*(.*?)\s*\}\}['"]/)?.[1]?.trim()||tag);else if(tag==='</sc-if>')stack.pop();else if(tag.includes('{{ '+action+' }}'))return [...stack];}throw Error('Action not found: '+action);}
test('Sales archive action has no enclosing administrator-only condition',()=>{const archive=ancestors('cd.remove');assert.equal(archive.includes('canManageSalesContact'),true);assert.equal(archive.includes('canManageRecords'),false);});
test('private price controls retain an enclosing administrator-only condition',()=>{assert.equal(ancestors('openPrice').includes('canManageRecords'),true);});
test('archive visibility repair is repeat-safe and describes recovery by CRM administrators',()=>{assert.equal(repairContactArchiveVisibility(template),template);assert.equal(template.includes('A CRM administrator can restore the contact and review your reason.'),true);assert.equal(template.includes('Ibrar can restore the contact'),false);assert.match(template,/CRM administrators can restore it from Settings/);});
