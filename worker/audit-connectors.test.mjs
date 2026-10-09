import test from 'node:test';
import assert from 'node:assert/strict';
import { publicUrl,targetInput,connectorStatus,collect,handleAuditConnectors,pageEvidence } from './audit-connectors.mjs';
const owner={isOwner:true,orgId:'org-a',id:'owner'};
const target=targetInput({name:'Example Agent',city:'Austin',brokerage:'Example Realty',email:'private@example.test',phone:'555',identityConfirmed:true,links:{instagram:'https://www.instagram.com/exampleagent/',zillow:'https://www.zillow.com/profile/exampleagent/'}});
const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
test('unsafe public URLs and source mismatches are rejected',()=>{
  for(const u of ['http://example.com','https://127.0.0.1','https://[::1]','https://user:pass@example.com','https://example.com:8443','https://example.local','https://example.com/?token=secret'])assert.throws(()=>publicUrl(u,'website'));
  assert.throws(()=>publicUrl('https://zillow.com.evil.com/profile/a','zillow'));
  assert.equal(publicUrl('https://www.zillow.com/profile/a#reviews','zillow'),'https://www.zillow.com/profile/a');
});
test('Instagram accepts profile links only',()=>assert.throws(()=>targetInput({name:'A',links:{instagram:'https://instagram.com/p/abc/'}})));
test('status never exposes credentials and requires explicit Meta version',()=>{
 const data=connectorStatus({AUDIT_META_TOKEN:'secret',AUDIT_META_IG_ID:'1',AUDIT_BRAVE_KEY:'hidden'});
 assert.equal(data.find(x=>x.source==='instagram').ready,false);assert.ok(!JSON.stringify(data).includes('hidden'));assert.ok(!JSON.stringify(data).includes('"secret"'));
});
test('discovery sends no phone/email and never confirms identity',async()=>{
 let called;const out=await collect('discovery',target,{AUDIT_BRAVE_KEY:'key'},async(u)=>{called=u;return response({web:{results:[{title:'Profile',url:'https://example.com',description:'Agent'}]}})});
 assert.ok(!called.includes('private'));assert.ok(!called.includes('555'));assert.equal(out.identityConfirmed,false);assert.equal(out.status,'candidates');
});
test('Firecrawl discovery works without Brave and sends no private identifiers or extra tools',async()=>{
 let request;const out=await collect('discovery',target,{AUDIT_FIRECRAWL_KEY:'test-key'},async(u,o)=>{request={u,o};return response({success:true,data:{web:[{title:'Agent',url:'https://www.zillow.com/profile/agent/',description:'Profile'},{title:'Unsafe',url:'https://127.0.0.1'}]}});});
 const payload=JSON.parse(request.o.body);assert.equal(request.u,'https://api.firecrawl.dev/v2/search');assert.equal(request.o.headers.Authorization,'Bearer test-key');assert.deepEqual(payload.sources,['web']);assert.equal(payload.domainTools,false);assert.equal(payload.limit,10);assert.ok(!request.o.body.includes('private'));assert.ok(!request.o.body.includes('555'));assert.equal(payload.scrapeOptions,undefined);assert.equal(out.provider,'Firecrawl Search');assert.equal(out.candidates.length,1);assert.equal(out.identityConfirmed,false);assert.equal(connectorStatus({AUDIT_FIRECRAWL_KEY:'test-key'})[0].ready,true);
});
test('unsuccessful Firecrawl search is not presented as missing profiles',async()=>{
 await assert.rejects(collect('discovery',target,{AUDIT_FIRECRAWL_KEY:'test-key'},async()=>response({success:false})),/unsuccessful/);
});
test('Meta uses operator ID, target handle, bounded posts and bearer header',async()=>{
 let request;const out=await collect('instagram',target,{AUDIT_META_TOKEN:'private-token',AUDIT_META_IG_ID:'123',AUDIT_META_VERSION:'v25.0'},async(u,o)=>{request={u,o};return response({business_discovery:{username:'exampleagent',media:{data:[]}}});});
 assert.ok(request.u.includes('/123?'));assert.ok(decodeURIComponent(request.u).includes('media.limit(12)'));assert.ok(!request.u.includes('private-token'));assert.equal(request.o.headers.Authorization,'Bearer private-token');assert.equal(out.status,'collected');
});
test('provider auth errors do not leak vendor bodies or token',async()=>{
 await assert.rejects(collect('instagram',target,{AUDIT_META_TOKEN:'secret',AUDIT_META_IG_ID:'123',AUDIT_META_VERSION:'v25.0'},async()=>new Response('secret',{status:401})),/authorization failed/);
});
test('web extraction uses fixed vendor and marks unavailable pages',async()=>{
 const out=await collect('zillow',target,{AUDIT_FIRECRAWL_KEY:'key'},async(u,o)=>{assert.equal(u,'https://api.firecrawl.dev/v2/scrape');assert.equal(JSON.parse(o.body).url,target.links.zillow);return response({success:false});});assert.equal(out.status,'not_assessed');assert.deepEqual(out.evidence,[]);
});
test('unconfirmed identity makes zero provider calls',async()=>{
 let count=0;await assert.rejects(collect('zillow',{...target,identityConfirmed:false},{AUDIT_FIRECRAWL_KEY:'key'},async()=>{count++;}),/Confirm/);assert.equal(count,0);
});
test('wrong-source canonical URL is rejected',async()=>{
 await assert.rejects(collect('zillow',target,{AUDIT_FIRECRAWL_KEY:'key'},async()=>response({success:true,data:{markdown:'Text',metadata:{sourceURL:'https://evil.com'}}})),/does not match/);
});
test('all routes reject non-owner without reading storage',async()=>{
 const r=await handleAuditConnectors(new Request('https://crm.test/api/audit-connectors/status'),{}, {isOwner:false});assert.equal(r.status,403);
});
test('paid collection needs explicit confirmation before storage or provider access',async()=>{
 const r=await handleAuditConnectors(new Request('https://crm.test/api/audit-connectors/collect',{method:'POST',body:JSON.stringify({source:'discovery',target,runId:'request-123'})}),{AUDIT_BRAVE_KEY:'key'},owner);assert.equal(r.status,409);
});
test('manual CRM evidence requires authorization',async()=>{
 const r=await handleAuditConnectors(new Request('https://crm.test/api/audit-connectors/manual',{method:'POST',body:JSON.stringify({source:'crm',target,text:'Provided by agent',observedAt:new Date().toISOString().slice(0,10)})}),{},owner);assert.equal(r.status,400);assert.match((await r.json()).error,/authorization/);
});
test('existing run IDs never call provider twice',async()=>{
 const DB={prepare:()=>({bind:()=>({first:async()=>({status:'collected',result_json:'{"evidence":[]}'})})})};let called=false;
 const r=await handleAuditConnectors(new Request('https://crm.test/api/audit-connectors/collect',{method:'POST',body:JSON.stringify({source:'discovery',target,runId:'request-123',allowPaid:true})}),{DB,AUDIT_BRAVE_KEY:'key'},owner,async()=>{called=true;});assert.equal(r.status,200);assert.equal((await r.json()).reused,true);assert.equal(called,false);
});
test('Facebook numeric page URLs permit only the public id parameter',()=>{
 assert.equal(publicUrl('https://www.facebook.com/profile.php?id=61595380550426','facebook'),'https://www.facebook.com/profile.php?id=61595380550426');
 assert.throws(()=>publicUrl('https://www.facebook.com/profile.php?id=123&access_token=secret','facebook'));
});
test('source-specific search filters candidates and retains unverified status',async()=>{
 let payload;const t=targetInput({...target,searchSource:'realtor'});
 const out=await collect('discovery',t,{AUDIT_FIRECRAWL_KEY:'key'},async(u,o)=>{payload=JSON.parse(o.body);return response({success:true,data:{web:[{url:'https://www.realtor.com/realestateagents/123',title:'Agent'},{url:'https://other.example/agent'}]}});});
 assert.match(payload.query,/site:realtor.com/);assert.equal(out.candidates.length,1);assert.equal(out.identityConfirmed,false);
});
test('map images do not crowd useful listing and review evidence out',()=>{
 const raw=Array(100).fill('![](https://maps.googleapis.com/maps/vt?'+ 'x'.repeat(300)+')').join('\n')+'\n## Reviews\nExcellent communication\n## For sale\n13 properties';
 const result=pageEvidence(raw,'Agent profile');assert.match(result.text,/Excellent communication/);assert.match(result.text,/13 properties/);assert.ok(!result.text.includes('maps.googleapis'));assert.equal(result.truncated,false);
});
test('access screens with HTTP success remain not assessed',async()=>{
 const out=await collect('zillow',target,{AUDIT_FIRECRAWL_KEY:'key'},async()=>response({success:true,data:{markdown:'Please verify you are human to continue',metadata:{statusCode:200,title:'Security check'}}}));
 assert.equal(out.status,'not_assessed');assert.deepEqual(out.evidence,[]);
});
test('individual listing pages preserve attribution limits and truncation',async()=>{
 const t=targetInput({...target,links:{listing:'https://broker.example/properties/123'}});
 const out=await collect('listing',t,{AUDIT_FIRECRAWL_KEY:'key'},async()=>response({success:true,data:{markdown:'Listing details '.repeat(2000),metadata:{title:'123 Main Street'}}}));
 assert.equal(out.evidence[0].kind,'public_listing');assert.equal(out.evidence[0].truncated,true);assert.match(out.note,/photo quality is not assessed/i);
});
test('Facebook limited evidence excludes other Pages and does not imply full metrics',async()=>{
 const t=targetInput({...target,links:{facebook:'https://www.facebook.com/ExampleAgent/'}});
 const out=await collect('facebook',t,{AUDIT_FIRECRAWL_KEY:'key'},async()=>response({success:true,data:{web:[{url:'https://www.facebook.com/ExampleAgent/',description:'Public excerpt'},{url:'https://www.facebook.com/OtherAgent/',description:'Other person'},{url:'https://www.facebook.com/ExampleAgentImposter/',description:'Wrong page'}]}}));
 assert.equal(out.status,'limited');assert.equal(out.evidence.length,1);assert.equal(out.evidence[0].indexDateUnknown,true);assert.match(out.note,/not verified current follower counts/);
});
