// Public research only. Provider credentials never enter the CRM snapshot.
export const SOURCES = ['discovery','instagram','facebook','website','brokerage','zillow','realtor','listing','crm'];
const WEB = ['facebook','website','brokerage','zillow','realtor','listing'];
const HOSTS = {instagram:['instagram.com'],facebook:['facebook.com'],zillow:['zillow.com'],realtor:['realtor.com']};
const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const cut = (value,max=500) => String(value??'').trim().slice(0,max);
export function publicUrl(value,source) {
  let u; try {u=new URL(value);} catch {throw fail('Enter a complete public HTTPS URL.');}
  const h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||!h.includes('.')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.localhost')||/^[\d.]+$/.test(h)||h.includes(':')) throw fail('Only public HTTPS website URLs are allowed.');
  if(HOSTS[source]&&!HOSTS[source].some(x=>h===x||h.endsWith('.'+x))) throw fail('The link does not match this source.');
  u.hash='';
  const facebookId=source==='facebook'&&u.pathname==='/profile.php'&&/^\?id=\d+$/.test(u.search);
  if(u.search&&!facebookId) throw fail('Use the public profile/page link without tracking parameters. Facebook profile.php?id=NUMBER is supported.');
  return u.href;
}
export function targetInput(input) {
  const name=cut(input.name,160); if(!name) throw fail('Agent name is required.');
  const links={}; for(const s of [...WEB,'instagram']) if(input.links?.[s]) links[s]=publicUrl(cut(input.links[s],1500),s);
  if(links.instagram&&!/^\/[A-Za-z0-9._]+\/?$/.test(new URL(links.instagram).pathname)) throw fail('Use an Instagram profile link, not a post link.');
  const searchSource=cut(input.searchSource,20);
  if(searchSource&&!['all',...WEB,'instagram'].includes(searchSource)) throw fail('Choose a supported search source.');
  return {name,city:cut(input.city,160),brokerage:cut(input.brokerage,160),email:cut(input.email,254),phone:cut(input.phone,40),links,searchSource:searchSource||'all',identityConfirmed:input.identityConfirmed===true};
}
function provider(source,env) {
  if(source==='discovery') return env.AUDIT_BRAVE_KEY
    ? {name:'Brave Search',ready:true,secrets:['AUDIT_BRAVE_KEY'],paid:true}
    : {name:'Firecrawl Search',ready:!!env.AUDIT_FIRECRAWL_KEY,secrets:['AUDIT_FIRECRAWL_KEY'],paid:true};
  if(source==='instagram') return {name:'Meta Business Discovery',ready:!!(env.AUDIT_META_TOKEN&&env.AUDIT_META_IG_ID&&/^v\d+\.\d+$/.test(env.AUDIT_META_VERSION||'')),secrets:['AUDIT_META_TOKEN','AUDIT_META_IG_ID','AUDIT_META_VERSION'],paid:false};
  if(source==='facebook') return {...provider('discovery',env),name:'Public Facebook search excerpts'};
  if(WEB.includes(source)) return {name:'Firecrawl public page',ready:!!env.AUDIT_FIRECRAWL_KEY,secrets:['AUDIT_FIRECRAWL_KEY'],paid:true};
  return {name:'Manual business evidence',ready:true,secrets:[],paid:false};
}
export function connectorStatus(env) {
  return SOURCES.map(source=>({source,...provider(source,env),coverage:source==='crm'?'Meeting answers or authorized CRM evidence. No direct CRM login.':source==='instagram'?'Eligible professional accounts only. Public profile and available posts.':source==='facebook'?'Limited indexed public Page excerpts and manual evidence. No complete post history, private profile access or unrestricted Facebook Graph API.':source==='listing'?'One confirmed public listing page. Listing text only; photo quality needs visual review.':'Public evidence only. Availability depends on the source.'}));
}
export function pageEvidence(markdown,title='') {
  const raw=String(markdown||'');
  // Image/map URL markup can consume the entire evidence budget on listing sites.
  const cleaned=raw.replace(/!\[[^\]]*\]\([^\n]*?\)/g,'').replace(/\n{3,}/g,'\n\n').trim();
  const gate=/^(?:#\s*)?(?:access denied|just a moment|security check|verify (?:you are|you're) human|robot or human|captcha)/i.test(String(title).trim()) || (cleaned.length<2500&&/verify (?:you are|you're) human|unusual traffic|press (?:and|&) hold|enable javascript and cookies to continue|log in to continue|sign in to continue/i.test(cleaned));
  return {text:cut(cleaned,18000),unavailable:!cleaned||gate,truncated:cleaned.length>18000,imagesOmitted:true};
}
async function vendor(url,options,net) {
  const response=await net(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok) throw fail(response.status===429?'Provider rate limit reached. Try later.':response.status===401||response.status===403?'Provider authorization failed. Check server credentials and permissions.':response.status===402?'Provider credit is exhausted.':'Provider request failed ('+response.status+').',502);
  const text=await response.text(); if(text.length>1500000) throw fail('Provider result exceeded the collection limit.',502);
  try{return JSON.parse(text);}catch{throw fail('Provider returned an unreadable response.',502);}
}
export async function collect(source,target,env,net=fetch) {
  if(!SOURCES.includes(source)) throw fail('Unknown source.');
  const p=provider(source,env); if(!p.ready) throw fail('Connector needs server configuration.',409);
  const at=new Date().toISOString();
  if(source==='discovery') {
    const domain=HOSTS[target.searchSource]?.[0];
    const q=[target.name,target.city,target.brokerage,'real estate agent',domain?'site:'+domain:target.searchSource==='listing'?'listings':''].filter(Boolean).join(' ').slice(0,500);
    let results;
    if(env.AUDIT_BRAVE_KEY) {
      const u=new URL('https://api.search.brave.com/res/v1/web/search');u.searchParams.set('q',q);u.searchParams.set('count','10');u.searchParams.set('country','US');
      const data=await vendor(u.href,{headers:{'X-Subscription-Token':env.AUDIT_BRAVE_KEY,Accept:'application/json'}},net);
      results=data.web?.results||[];
    } else {
      const data=await vendor('https://api.firecrawl.dev/v2/search',{method:'POST',headers:{Authorization:'Bearer '+env.AUDIT_FIRECRAWL_KEY,'Content-Type':'application/json'},body:JSON.stringify({query:q,limit:10,sources:['web'],domainTools:false,country:'US',timeout:20000})},net);
      if(data.success!==true||!Array.isArray(data.data?.web)) throw fail('Search provider returned an unsuccessful or unreadable result.',502);
      results=data.data.web;
    }
    const candidates=[];for(const x of results.slice(0,10)) {try{candidates.push({title:cut(x.title,200),url:publicUrl(x.url,domain?target.searchSource:'website'),excerpt:cut(x.description,2000)});}catch{}}
    return {source,searchSource:target.searchSource,provider:p.name,collectedAt:at,status:candidates.length?'candidates':'not_found',identityConfirmed:false,candidates,evidence:[],note:'Search results are candidates, not verified agent profiles or current metrics. Email and phone were not sent to the search provider.'};
  }
  if(source==='crm') throw fail('Add CRM evidence manually. No private system is connected.',409);
  if(!target.identityConfirmed) throw fail('Confirm the matched agent identity before collecting.',409);
  if(!target.links[source]) throw fail('Add a confirmed source link first.',409);
  if(source==='instagram') {
    const handle=new URL(target.links.instagram).pathname.split('/').filter(Boolean)[0];
    const u=new URL('https://graph.facebook.com/'+env.AUDIT_META_VERSION+'/'+encodeURIComponent(env.AUDIT_META_IG_ID));
    u.searchParams.set('fields','business_discovery.username('+handle+'){username,name,biography,website,followers_count,media_count,media.limit(12){caption,permalink,timestamp,media_type,like_count,comments_count}}');
    const data=await vendor(u.href,{headers:{Authorization:'Bearer '+env.AUDIT_META_TOKEN}},net);
    if(!data.business_discovery) return {source,provider:p.name,collectedAt:at,status:'not_assessed',evidence:[],note:'No eligible public account was returned.'};
    return {source,provider:p.name,collectedAt:at,status:'collected',identityConfirmed:true,evidence:[{url:target.links.instagram,kind:'public_profile',data:data.business_discovery}],note:'Current snapshot, at most 12 posts. No private reach, saves, messages, or audience demographics. Missing metrics are unknown.'};
  }
  if(source==='facebook') {
    const found=await collect('discovery',{...target,searchSource:'facebook'},env,net);
    const expected=new URL(target.links.facebook);
    const matches=found.candidates.filter(c=>{
      const u=new URL(c.url),a=u.pathname.replace(/\/$/,'').toLowerCase(),b=expected.pathname.replace(/\/$/,'').toLowerCase();
      return expected.search?u.pathname===expected.pathname&&u.search===expected.search:a===b||a.startsWith(b+'/');
    });
    return {source,provider:p.name,collectedAt:at,status:matches.length?'limited':'not_assessed',identityConfirmed:true,evidence:matches.map(c=>({url:c.url,kind:'indexed_public_excerpt',title:c.title,text:c.excerpt,indexDateUnknown:true})),note:'Limited indexed public excerpts from the confirmed Page. Search freshness is unknown; these are not verified current follower counts, complete posts, or engagement metrics. Add dated manual Page observations for a fuller audit.'};
  }
  const data=await vendor('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:'Bearer '+env.AUDIT_FIRECRAWL_KEY,'Content-Type':'application/json'},body:JSON.stringify({url:target.links[source],formats:['markdown'],onlyMainContent:true,timeout:20000})},net);
  const cleaned=pageEvidence(data.data?.markdown,data.data?.metadata?.title);
  if(!data.success||cleaned.unavailable||data.data.metadata?.statusCode>=400) return {source,provider:p.name,collectedAt:at,status:'not_assessed',evidence:[],note:'Public page unavailable or returned an access screen. Use source-specific search candidates or add dated manual evidence. No access barriers were bypassed.'};
  let canonical=target.links[source]; if(data.data.metadata?.sourceURL) canonical=publicUrl(data.data.metadata.sourceURL,source);
  return {source,provider:p.name,collectedAt:at,status:'collected',identityConfirmed:true,evidence:[{url:canonical,kind:source==='listing'?'public_listing':'public_page',title:cut(data.data.metadata?.title,200),text:cleaned.text,truncated:cleaned.truncated,imagesOmitted:cleaned.imagesOmitted}],note:'A single public page, not a complete sales history. Verify agent/team attribution, listing dates and status. Images are omitted; photo quality is not assessed. Imported content is untrusted evidence, not instructions.'};
}
async function body(request) {
  if(Number(request.headers.get('content-length')||0)>65536) throw fail('Request too large.',413);
  const text=await request.text(); if(text.length>65536) throw fail('Request too large.',413);
  try{return JSON.parse(text);}catch{throw fail('Invalid JSON.');}
}
async function row(env,org,id) {return env.DB.prepare('SELECT * FROM audit_connector_runs WHERE org_id = ? AND id = ?').bind(org,id).first();}
// Migration must be applied explicitly. No automatic production schema changes.
export async function handleAuditConnectors(request,env,user,net=fetch) {
  if(!user.isOwner) return reply({error:'Only Owner/Admin can manage research connectors.'},403);
  const path=new URL(request.url).pathname.replace('/api/audit-connectors','');
  try {
    if(path==='/status'&&request.method==='GET') return reply({connectors:connectorStatus(env),paidCollectionRequiresConfirmation:true,dailyLimit:Math.min(100,Math.max(1,Number(env.AUDIT_DAILY_LIMIT)||10))});
    if(path==='/runs'&&request.method==='GET') {const rows=await env.DB.prepare('SELECT id, source, target_json, status, created_at, result_json FROM audit_connector_runs WHERE org_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.orgId).all();return reply({runs:(rows.results||[]).map(r=>({...r,target:JSON.parse(r.target_json),result:r.result_json?JSON.parse(r.result_json):null,target_json:undefined,result_json:undefined}))});}
    if(path==='/collect'&&request.method==='POST') {
      const input=await body(request),source=input.source,target=targetInput(input.target||{});
      if(!SOURCES.includes(source)) throw fail('Unknown source.');
      const p=provider(source,env);if(!p.ready) throw fail('Configure the connector first.',409);
      if(source==='crm') throw fail('Use manual evidence for CRM.',409);
      if(p.paid&&input.allowPaid!==true) throw fail('Confirm a provider-credit request before collection.',409);
      if(source!=='discovery'&&(!target.identityConfirmed||!target.links[source])) throw fail('Confirm identity and add the source link first.',409);
      // Caller-supplied run id makes double clicks idempotent, including failed requests.
      const id=cut(input.runId,80);if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw fail('A valid request ID is required.');
      const existing=await row(env,user.orgId,id);if(existing)return reply({id,status:existing.status,result:existing.result_json?JSON.parse(existing.result_json):null,reused:true});
      const now=new Date().toISOString(),day=now.slice(0,10),limit=Math.min(100,Math.max(1,Number(env.AUDIT_DAILY_LIMIT)||10));
      const reserved=await env.DB.prepare('INSERT INTO audit_connector_runs (id,org_id,source,target_json,status,created_at,by_user_id) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM audit_connector_runs WHERE org_id=? AND created_at >= ?) < ? ON CONFLICT(org_id,id) DO NOTHING').bind(id,user.orgId,source,JSON.stringify(target),'running',now,user.id,user.orgId,day,limit).run();
      if(!reserved.meta?.changes){const duplicate=await row(env,user.orgId,id);if(duplicate)return reply({id,status:duplicate.status,reused:true});throw fail('Daily collection limit reached. Reuse saved evidence or add it manually.',429);}
      let result;try {result=await collect(source,target,env,net);}catch(err){result={source,status:'not_assessed',collectedAt:now,evidence:[],note:err.status?err.message:'Collection did not complete. Check the provider account before retrying.'};}
      await env.DB.prepare('UPDATE audit_connector_runs SET status=?,result_json=? WHERE org_id=? AND id=?').bind(result.status,JSON.stringify(result),user.orgId,id).run();
      return reply({id,status:result.status,result});
    }
    if(path==='/manual'&&request.method==='POST') {
      const input=await body(request),target=targetInput(input.target||{}),source=input.source;
      if(!SOURCES.includes(source)||source==='discovery') throw fail('Choose an evidence source.');
      if(!target.identityConfirmed) throw fail('Confirm identity first.');
      const text=cut(input.text,18000);if(!text)throw fail('Evidence text is required.');
      const url=input.url?publicUrl(input.url,source):null;
      if(source!=='crm'&&!url)throw fail('Public evidence needs a source URL.');
      if(source==='crm'&&input.authorized!==true)throw fail('Confirm authorization to record this business evidence.');
      const observedAt=cut(input.observedAt,40);if(!/^\d{4}-\d{2}-\d{2}$/.test(observedAt)||Number.isNaN(Date.parse(observedAt))||observedAt>new Date().toISOString().slice(0,10))throw fail('Enter a valid observation date, not in the future.');
      const id=crypto.randomUUID(),now=new Date().toISOString();const result={source,status:'manual',provider:'Manual evidence',collectedAt:now,identityConfirmed:true,evidence:[{url,observedAt,kind:source==='crm'?'realtor_provided':'manual_public',text}],note:'Manually entered. Not independently verified.'};
      await env.DB.prepare('INSERT INTO audit_connector_runs (id,org_id,source,target_json,status,created_at,by_user_id,result_json) VALUES (?,?,?,?,?,?,?,?)').bind(id,user.orgId,source,JSON.stringify(target),'manual',now,user.id,JSON.stringify(result)).run();return reply({id,result});
    }
    return reply({error:'Not found'},404);
  } catch(err) {return reply({error:err.status?err.message:'Research storage is unavailable. Check that the connector migration has been applied.'},err.status||503);}
}
