import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const json = (value, status=200) => ({ok:status >= 200 && status < 300,headers:{get:()=> 'application/json'},json:async()=>value});

function surface() {
  const nodes = new Map(), listeners = new Map(), messages = [];
  class Node {
    constructor(tag='div') { this.tagName=tag.toUpperCase();this.children=[];this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.isConnected=true;this.dataset={};this.attributes={};this.style={};this.textContent='';this.classList={toggle(){}}; }
    set id(id) { this._id=id;nodes.set(id,this); } get id(){return this._id;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(name,value){this.attributes[name]=value;} removeAttribute(name){delete this.attributes[name];}
    addEventListener(name,fn){this['on'+name]=fn;}
    querySelectorAll(selector){const choices=selector.split(',').map(x=>x.trim().toUpperCase());return this.children.flatMap(child=>[...(choices.includes(child.tagName)?[child]:[]),...child.querySelectorAll(selector)]);}
    reportValidity(){return this.querySelectorAll('input,select,textarea').every(node=>!node.required || node.value.trim());}
    getBoundingClientRect(){return {height:500};}
    showModal(){this.open=true;}
    close(){this.open=false;this.onclose?.();}
    focus(){document.activeElement=this;}
  }
  const add = (id,tag='div',parent) => {const node=new Node(tag);node.id=id;parent?.append(node);return node;};
  const document = {getElementById:id=>nodes.get(id)||null,createElement:tag=>new Node(tag),createTextNode:text=>{const node=new Node('#text');node.textContent=text;return node;},querySelectorAll:selector=>[...nodes.values()].filter(node=>selector.split(',').map(x=>x.toUpperCase()).includes(node.tagName)),querySelector:selector=>selector==='main'?main:null,body:new Node('body')};
  const main=add('main','main');document.body.append(main);
  const window={parent:{postMessage:(message,origin)=>messages.push({message,origin})},addEventListener:(name,fn)=>listeners.set(name,fn),confirm:()=>true};
  const context={document,window,location:{search:'?embedded=1&contact=c1',origin:'https://crm.example.invalid'},URLSearchParams,JSON,Date,Map,setTimeout:()=>0,clearTimeout(){},setInterval(){},confirm:()=>true,console};
  vm.createContext(context);
  return {nodes,add,Node,main,window,context,listeners,messages};
}

async function audits({sample=false,initialStatus=200}={}) {
  const fixture=surface(), {add,nodes,context}=fixture;
  for(const [id,tag] of [['notice','p'],['detail','section'],['cases','div'],['search','input'],['contact-start','select'],['refresh','button'],['start','button'],['sample','button']])add(id,tag);
  const template=add('case-template','template');
  template.content={cloneNode(){
    const fragment=new fixture.Node('div');
    for(const id of ['contact-name','case-status','sample-notice','reports','evidence-results'])add(id,'div',fragment);
    for(const id of ['refresh-report','retry'])add(id,'button',fragment);
    const researchPanel=add('research-panel','details',fragment), research=add('research','form',researchPanel);add('research-fields','div',research);add('identity','input',research);add('credits','input',research);
    const meeting=add('meeting','form',fragment);add('meeting-progress','p',meeting);add('questions','div',meeting);add('services','div',meeting);add('service-notes','textarea',meeting);
    for(const id of ['sample-answers','suggest','save','generate'])add(id,'button',meeting);
    return fragment;
  }};
  const contact={id:'c1',name:'Fictional reviewer'};
  const row={id:'a1',contact_id:'c1',contact,status:'pre_ready',revision:3,created_at:'2026-10-07T00:00:00.000Z',answers:{health:'Healthy',process:'Saved process'},services:['03'],service_notes:'Saved scope',reports:[],evidence:[],sample,sampleAnswers:{health:'Needs work',process:'Fictional sample process'},sampleServices:['03'],sampleServiceNotes:'Fictional scope'};
  const payload={cases:[row],contacts:[contact],questions:[{id:'health',label:'CRM health',prompt:'Review the process',module:'03',type:'select',options:['Healthy','Needs work','Unknown'],required:true},{id:'process',label:'Process',prompt:'Describe the workflow',module:'03',type:'text',required:true}],services:[{id:'03',name:'CRM',price:200,we:'Maintain next actions',agent:'Approve priorities'}]};
  const calls=[];context.fetch=async(path,options)=>{calls.push({path,options});return json(initialStatus===200?payload:{error:'Owner access required.'},initialStatus);};
  const exportCode="globalThis.review={action,api,save,renderDetail,fillSampleAnswers,unsaved,load,getCurrent:()=>current};";
  vm.runInContext(source('audits.js').replace(/\}\)\(\);\s*$/,exportCode+'})();'),context);await settle();
  return {...fixture,payload,row,calls,review:context.review};
}

function warned(fixture) {let value=false;fixture.listeners.get('beforeunload')({preventDefault(){value=true;}});return value;}

test('initial audit GET, rendered saved fields and opening unchanged audits do not warn',async()=>{
  const fixture=await audits();assert.equal(fixture.window.sereneEmbeddedDirty(),false);assert.equal(warned(fixture),false);assert.equal(fixture.calls[0].options.method,'GET');
  fixture.review.renderDetail();assert.equal(fixture.window.sereneEmbeddedDirty(),false);assert.equal(warned(fixture),false);
});

test('audit edits warn, and reverting answers, services, notes and research fields clears the warning',async()=>{
  const fixture=await audits(), {nodes}=fixture;
  const answer=nodes.get('answer-process');answer.value='Changed process';answer.oninput();assert.equal(warned(fixture),true);answer.value='Saved process';answer.oninput();assert.equal(warned(fixture),false);
  const service=nodes.get('service-03');service.checked=false;service.onchange();assert.equal(fixture.window.sereneEmbeddedDirty(),true);service.checked=true;service.onchange();assert.equal(fixture.window.sereneEmbeddedDirty(),false);
  const notes=nodes.get('service-notes');notes.value='New scope';notes.oninput();assert.equal(warned(fixture),true);notes.value='Saved scope';notes.oninput();assert.equal(warned(fixture),false);
  nodes.get('url-website').value='https://example.invalid';nodes.get('research').oninput();assert.equal(warned(fixture),true);nodes.get('url-website').value='';nodes.get('research').oninput();assert.equal(warned(fixture),false);
});

test('a busy GET remains safe to leave, while a pending write warns and clears afterward',async()=>{
  const fixture=await audits();let release;
  fixture.context.fetch=()=>new Promise(resolve=>{release=resolve;});
  const reading=fixture.review.action(()=>fixture.review.api(''));assert.equal(fixture.window.sereneEmbeddedDirty(),false);assert.equal(warned(fixture),false);release(json(fixture.payload));await reading;
  const writing=fixture.review.action(()=>fixture.review.api('/a1/refresh-report','POST',{}));assert.equal(fixture.window.sereneEmbeddedDirty(),true);assert.equal(warned(fixture),true);release(json({ok:true}));await writing;assert.equal(fixture.window.sereneEmbeddedDirty(),false);
});

test('failed read or write does not discard a real unsaved draft',async()=>{
  const fixture=await audits(), answer=fixture.nodes.get('answer-process');answer.value='Keep this draft';answer.oninput();
  fixture.context.fetch=async()=>json({error:'Unavailable'},503);await fixture.review.action(()=>fixture.review.load(false));assert.equal(answer.value,'Keep this draft');assert.equal(warned(fixture),true);
  await fixture.review.action(()=>fixture.review.save());assert.equal(answer.value,'Keep this draft');assert.equal(warned(fixture),true);
});

test('suggesting services already selected leaves the audit unchanged',async()=>{
  const fixture=await audits();fixture.row.answers.health='Needs work';fixture.review.renderDetail();
  fixture.nodes.get('suggest').onclick();assert.equal(fixture.nodes.get('service-03').checked,true);assert.equal(warned(fixture),false);
});

test('successful draft saves clear only saved meeting changes and preserve separate research edits',async()=>{
  const fixture=await audits(), {nodes}=fixture;nodes.get('answer-process').value='Saved second process';nodes.get('answer-process').oninput();nodes.get('url-website').value='https://example.invalid';nodes.get('research').oninput();
  fixture.context.fetch=async(path,options)=>{assert.match(path,/\/answers$/);assert.equal(options.method,'PUT');return json({audit:{revision:4,answers:{health:'Healthy',process:'Saved second process'},services:['03'],service_notes:'Saved scope'}});};
  await fixture.review.action(()=>fixture.review.save());assert.equal(fixture.review.getCurrent().revision,4);assert.equal(warned(fixture),true);
  nodes.get('url-website').value='';nodes.get('research').oninput();assert.equal(warned(fixture),false);
});

test('sample answers populate a labelled local draft with only a read of the sample helper',async()=>{
  const fixture=await audits({sample:true});let reads=0;
  fixture.context.fetch=async(path,options)=>{assert.equal(path,'/api/audits/a1');assert.equal(options.method,'GET');reads++;return json({sample:true,sampleAnswers:fixture.row.sampleAnswers,sampleServices:fixture.row.sampleServices,sampleServiceNotes:fixture.row.sampleServiceNotes});};
  assert.equal(fixture.nodes.get('sample-notice').hidden,false);assert.equal(fixture.nodes.get('research-panel').hidden,true);assert.equal(fixture.nodes.get('sample-answers').hidden,false);
  await fixture.nodes.get('sample-answers').onclick();assert.equal(fixture.nodes.get('answer-health').value,'Needs work');assert.equal(fixture.nodes.get('answer-process').value,'Fictional sample process');assert.equal(fixture.nodes.get('service-notes').value,'Fictional scope');assert.equal(reads,1);assert.equal(warned(fixture),true);
});

test('sample creation notifies parent after success and preserves saved answers on reuse',async()=>{
  const fixture=await audits({sample:true});fixture.context.fetch=async(path,options)=>{if(path.endsWith('/sample')){assert.equal(options.method,'POST');return json({id:'a1',sample:true,reused:true});}return json(fixture.payload);};
  fixture.nodes.get('sample').onclick();await settle();assert.ok(fixture.messages.some(item=>item.message.type==='serene-audit-documents-updated'));assert.equal(fixture.nodes.get('answer-process').value,'Saved process');assert.equal(warned(fixture),false);
});

test('owner-only sample button stays disabled after denied audit access',async()=>{
  const fixture=await audits({initialStatus:403});assert.equal(fixture.nodes.get('sample').disabled,true);assert.equal(warned(fixture),false);
});

async function users({user={id:'u1',name:'Fictional assigned user',email:'assigned@example.invalid',status:'active',isOwner:false,sections:['work'],editSections:['work']},invitationReady=true}={}) {
  const fixture=surface(), {add,nodes,context}=fixture;
  for(const [id,tag] of [['notice','p'],['detail','section'],['users','div'],['new','button']])add(id,tag);
  const invitationReview=add('invitation-review','dialog');
  for(const [id,tag] of [['review-title','h2'],['review-action','p'],['review-name','strong'],['review-email','span'],['review-profile','dd'],['review-scope','dd'],['review-sections','ul'],['review-warning','p'],['review-duplicate-label','label'],['review-duplicate','input'],['review-cancel','button'],['review-approve','button']])add(id,tag,invitationReview);
  const template=add('user-template','template');template.content={cloneNode(){const fragment=new fixture.Node('div'),form=add('user-form','form',fragment);for(const id of ['name-title','identity-help','visibility-help','scope-help','invitation-status','invite-help','mail-preview'])add(id,'p',form);for(const id of ['name','email','invite-new'])add(id,'input',form);for(const id of ['status','profile','scope'])add(id,'select',form);add('profile-panel','section',form);add('sections','div',form);add('invite-new-label','label',form);add('invitation-panel','section',form);add('invite','button',form);add('save','button',form);return fragment;}};
  const payload={users:user?[user]:[],sections:['today','calendar','clients','contacts','pipeline','calls','work','tickets','activity','social'].map(id=>({id,label:(['contacts','calls','work','tickets','social'].includes(id)?'Assigned ':'')+id[0].toUpperCase()+id.slice(1),editable:['contacts','pipeline','calls','work','tickets','social'].includes(id)})),invitationReady,loginUrl:'https://crm.example.invalid'};
  const calls=[];context.fetch=async(path,options)=>{calls.push({path,options});return json(payload);};vm.runInContext(source('users.js').replace(/\}\)\(\);\s*$/,"globalThis.review={render,canLeave};})();"),context);await settle();fixture.context.review.render(user);return {...fixture,payload,calls};
}

test('unchanged and reverted visibility settings do not warn on navigation or closing',async()=>{
  const fixture=await users();assert.equal(warned(fixture),false);const see=fixture.nodes.get('see-work'),edit=fixture.nodes.get('edit-work');see.checked=false;see.onchange();assert.equal(edit.checked,false);assert.equal(warned(fixture),true);edit.checked=true;edit.onchange();assert.equal(see.checked,true);assert.equal(warned(fixture),false);
  const status=fixture.nodes.get('status');status.value='disabled';status.onchange();assert.equal(warned(fixture),true);status.value='active';status.onchange();assert.equal(warned(fixture),false);
});

test('Sales role preset selects only its three editable sections and reverting restores contributor permissions cleanly',async()=>{
  const f=await users(),{nodes}=f;assert.equal(nodes.get('profile').value,'contributor');assert.equal(nodes.get('scope').disabled,true);assert.equal(nodes.get('see-pipeline').disabled,true);assert.equal(warned(f),false);
  nodes.get('profile').value='sales_associate';nodes.get('profile').onchange();
  for(const id of ['contacts','pipeline','calls']){assert.equal(nodes.get('see-'+id).checked,true,id);assert.equal(nodes.get('edit-'+id).checked,true,id);assert.equal(nodes.get('edit-'+id).disabled,false,id);}
  for(const id of ['today','calendar','clients','work','tickets','activity','social']){assert.equal(nodes.get('see-'+id).checked,false,id);assert.equal(nodes.get('see-'+id).disabled,true,id);}
  nodes.get('scope').value='all_sales';nodes.get('scope').onchange();assert.match(nodes.get('visibility-help').textContent,/all contacts and deals/);assert.equal(warned(f),true);
  nodes.get('profile').value='contributor';nodes.get('profile').onchange();assert.equal(nodes.get('scope').value,'assigned');assert.equal(nodes.get('see-work').checked,true);assert.equal(nodes.get('edit-work').checked,true);assert.equal(warned(f),false);
});

test('Sales scope can be reverted independently and unsaved role changes block invitation',async()=>{
  const f=await users({user:{id:'u1',name:'Fictional Sales associate',email:'sales@example.invalid',status:'active',isOwner:false,profile:'sales_associate',scope:'all_sales',sections:['contacts','pipeline','calls'],editSections:['contacts','pipeline','calls']}}),{nodes}=f;
  assert.equal(warned(f),false);nodes.get('scope').value='assigned';nodes.get('scope').onchange();assert.equal(warned(f),true);const count=f.calls.length;await nodes.get('invite').onclick();assert.equal(f.calls.length,count);assert.match(nodes.get('notice').textContent,/Save these visibility changes/);
  nodes.get('scope').value='all_sales';nodes.get('scope').onchange();assert.equal(warned(f),false);
});

test('saving a Sales profile posts explicit scope and three edit permissions without sending an invitation',async()=>{
  const f=await users(),{nodes}=f;nodes.get('profile').value='sales_associate';nodes.get('profile').onchange();nodes.get('scope').value='all_sales';nodes.get('scope').onchange();let saved;
  f.context.fetch=async(path,options)=>{if(options.method==='PUT'){assert.equal(path,'/api/users/u1');saved=JSON.parse(options.body);f.payload.users[0]={...f.payload.users[0],...saved};return json({ok:true,id:'u1',profile:saved.profile,scope:saved.scope});}assert.equal(options.method,'GET');return json(f.payload);};
  await nodes.get('user-form').onsubmit({preventDefault(){}});assert.equal(saved.profile,'sales_associate');assert.equal(saved.scope,'all_sales');assert.equal(saved.invite,false);assert.deepEqual(saved.sections,['contacts','pipeline','calls']);assert.deepEqual(saved.editSections,['contacts','pipeline','calls']);assert.equal(f.nodes.get('profile').value,'sales_associate');assert.equal(warned(f),false);assert.ok(f.messages.some(item=>item.message.type==='serene-users-updated'));
});

test('failed Sales profile save keeps the role, scope and invitation state in an unsaved draft',async()=>{
  const f=await users(),{nodes}=f;nodes.get('profile').value='sales_associate';nodes.get('profile').onchange();nodes.get('scope').value='all_sales';nodes.get('scope').onchange();f.context.fetch=async()=>json({error:'Save conflict. Reload and try again.'},409);
  await nodes.get('user-form').onsubmit({preventDefault(){}});assert.equal(nodes.get('profile').value,'sales_associate');assert.equal(nodes.get('scope').value,'all_sales');assert.equal(warned(f),true);assert.match(nodes.get('notice').textContent,/Save conflict/);assert.equal(nodes.get('invite').disabled,false);
});

test('primary owner access is fixed and new contributor defaults remain unchanged',async()=>{
  const owner=await users({user:{id:'owner',name:'Fictional owner',email:'owner@example.invalid',status:'active',isOwner:true,sections:[],editSections:[]}});assert.equal(owner.nodes.get('profile-panel').hidden,true);assert.equal(owner.nodes.get('profile').disabled,true);assert.equal(owner.nodes.get('save').disabled,true);assert.equal(warned(owner),false);
  const fresh=await users({user:null,invitationReady:false});assert.equal(fresh.nodes.get('profile').value,'contributor');assert.equal(fresh.nodes.get('scope').value,'assigned');assert.equal(fresh.nodes.get('invite-new').checked,false);assert.deepEqual(fresh.payload.sections.filter(s=>fresh.nodes.get('see-'+s.id).checked).map(s=>s.id),['today','calendar','clients','work','tickets','activity']);assert.equal(warned(fresh),false);
});

test('administrator selection explains full access and approval is required before its role save, with Cancel sending nothing',async()=>{
 const f=await users(),{nodes}=f;nodes.get('profile').value='administrator';nodes.get('profile').onchange();assert.equal(nodes.get('scope').value,'all');assert.equal(nodes.get('scope').disabled,true);assert.match(nodes.get('visibility-help').textContent,/finance.*private notes.*connected mail/);assert.ok(f.payload.sections.every(s=>nodes.get('see-'+s.id).checked&&nodes.get('see-'+s.id).disabled));
 let saved,writes=0;f.context.fetch=async(path,options)=>{if(options.method==='PUT'){writes++;saved=JSON.parse(options.body);f.payload.users[0]={...f.payload.users[0],...saved,isOwner:true,isPrimaryOwner:false};return json({ok:true,id:'u1'});}return json(f.payload);};
 const submit=()=>nodes.get('user-form').onsubmit({preventDefault(){}}),cancelled=submit();assert.equal(nodes.get('invitation-review').open,true);assert.equal(nodes.get('review-title').textContent,'Review administrator access');assert.equal(nodes.get('review-profile').textContent,'Administrator');assert.equal(nodes.get('review-scope').textContent,'Full CRM workspace');assert.match(nodes.get('review-action').textContent,/No invitation email/);assert.ok(nodes.get('review-sections').children.some(n=>/Financial information/.test(n.textContent)));assert.equal(writes,0);nodes.get('review-cancel').onclick();await cancelled;assert.equal(writes,0);
 const approved=submit();nodes.get('review-approve').onclick();await approved;assert.equal(writes,1);assert.equal(saved.administratorAcknowledged,true);assert.equal(saved.profile,'administrator');assert.equal(saved.scope,'all');assert.equal(saved.invite,false);assert.equal(f.nodes.get('profile-panel').hidden,false);assert.equal(f.nodes.get('profile').disabled,false);assert.equal(warned(f),false);
});

test('secondary administrator remains editable and role demotion restores configurable contributor sections',async()=>{
 const f=await users({user:{id:'u_secondary',name:'Fictional secondary administrator',email:'administrator@example.invalid',status:'active',isOwner:true,isPrimaryOwner:false,profile:'administrator',scope:'all',sections:['work','contacts'],editSections:['work','contacts']}}),{nodes}=f;
 assert.equal(nodes.get('profile-panel').hidden,false);assert.equal(nodes.get('profile').disabled,false);assert.equal(nodes.get('save').disabled,false);nodes.get('profile').value='contributor';nodes.get('profile').onchange();assert.equal(nodes.get('scope').value,'assigned');assert.equal(nodes.get('see-work').disabled,false);assert.equal(nodes.get('edit-work').disabled,false);assert.equal(nodes.get('see-contacts').checked,false);assert.equal(nodes.get('edit-contacts').disabled,true);
});

test('invitation review shows the recipient and saved access, traps focus in a native dialog and Cancel sends nothing',async()=>{
  const f=await users(),{nodes}=f;f.window.confirm=()=>{throw Error('Invitation must not use a native browser confirmation');};nodes.get('invite').focus();const count=f.calls.length,pending=nodes.get('invite').onclick();
  assert.equal(nodes.get('invitation-review').open,true);assert.equal(f.context.document.activeElement,nodes.get('review-cancel'));assert.equal(nodes.get('review-email').textContent,'assigned@example.invalid');assert.equal(nodes.get('review-profile').textContent,'Assigned contributor');assert.equal(nodes.get('review-scope').textContent,'Assigned records only');assert.equal(nodes.get('review-sections').children[0].textContent,'Assigned Work — may update');assert.equal(f.calls.length,count);assert.equal(warned(f),false);
  nodes.get('review-cancel').onclick();await pending;assert.equal(f.calls.length,count);assert.equal(nodes.get('invitation-review').open,false);assert.equal(f.context.document.activeElement,nodes.get('invite'));assert.equal(warned(f),false);
});

test('Escape and externally closing an invitation review both cancel without a request',async()=>{
  const f=await users(),{nodes}=f,count=f.calls.length;let prevented=false;const pending=nodes.get('invite').onclick();nodes.get('invitation-review').oncancel({preventDefault(){prevented=true;}});await pending;assert.equal(prevented,true);assert.equal(f.calls.length,count);
  const second=nodes.get('invite').onclick();nodes.get('invitation-review').close();await second;assert.equal(f.calls.length,count);assert.equal(nodes.get('invitation-review').open,false);
});

test('approved invitation sends once despite repeated open and approval clicks',async()=>{
  const f=await users(),{nodes}=f;let writes=0,release;
  f.context.fetch=async(path,options)=>{if(options.method==='POST'){writes++;assert.equal(path,'/api/users/u1/invite');assert.deepEqual(JSON.parse(options.body),{resend:false});return new Promise(resolve=>{release=resolve;});}return json(f.payload);};
  const pending=nodes.get('invite').onclick();await nodes.get('invite').onclick();assert.equal(writes,0);nodes.get('review-approve').onclick();nodes.get('review-approve').onclick();await settle();assert.equal(writes,1);assert.equal(warned(f),true);release(json({ok:true,accessNotice:'Fictional invitation saved'}));await pending;assert.equal(writes,1);assert.equal(nodes.get('invitation-review').open,false);assert.equal(warned(f),false);
});

test('unconfirmed invitation resend requires Sent mail acknowledgment and retains explicit resend intent',async()=>{
  const f=await users({user:{id:'u1',name:'Fictional recipient',email:'recipient@example.invalid',status:'active',isOwner:false,sections:['work'],editSections:[],invitation_status:'send_unknown'}}),{nodes}=f;let writes=0;
  f.context.fetch=async(path,options)=>{if(options.method==='POST'){writes++;assert.deepEqual(JSON.parse(options.body),{resend:true});return json({ok:true});}return json(f.payload);};
  const pending=nodes.get('invite').onclick();assert.match(nodes.get('review-warning').textContent,/Check Sent mail/);assert.equal(nodes.get('review-duplicate-label').hidden,false);assert.equal(nodes.get('review-approve').disabled,true);nodes.get('review-approve').onclick();await settle();assert.equal(writes,0);assert.equal(nodes.get('invitation-review').open,true);
  nodes.get('review-duplicate').checked=true;nodes.get('review-duplicate').onchange();assert.equal(nodes.get('review-approve').disabled,false);nodes.get('review-approve').onclick();await pending;assert.equal(writes,1);
});

test('combined new-user save and invitation require the reviewed Sales recipient approval before any write',async()=>{
  const f=await users({user:null}),{nodes}=f;nodes.get('name').value='Fictional new Sales user';nodes.get('email').value='newsales@example.invalid';nodes.get('profile').value='sales_associate';nodes.get('profile').onchange();nodes.get('scope').value='all_sales';nodes.get('scope').onchange();let writes=0;
  f.context.fetch=async(path,options)=>{if(options.method==='POST'){assert.equal(path,'/api/users');writes++;const input=JSON.parse(options.body);assert.equal(input.invite,true);assert.equal(input.email,'newsales@example.invalid');assert.equal(input.scope,'all_sales');assert.deepEqual(input.editSections,['contacts','pipeline','calls']);f.payload.users=[{...input,id:'qa-new',isOwner:false,invitation_status:'sent'}];return json({ok:true,id:'qa-new',invitationStatus:'sent'});}return json(f.payload);};
  const submit=()=>nodes.get('user-form').onsubmit({preventDefault(){}});const cancelled=submit();assert.match(nodes.get('review-action').textContent,/Create this account/);assert.equal(nodes.get('review-email').textContent,'newsales@example.invalid');assert.equal(nodes.get('review-profile').textContent,'Sales associate');assert.equal(nodes.get('review-scope').textContent,'All active sales contacts and deals');assert.equal(nodes.get('review-sections').children.length,3);assert.equal(writes,0);nodes.get('review-cancel').onclick();await cancelled;assert.equal(writes,0);assert.equal(nodes.get('email').value,'newsales@example.invalid');assert.equal(warned(f),true);
  const approved=submit();nodes.get('review-approve').onclick();nodes.get('review-approve').onclick();await approved;assert.equal(writes,1);assert.equal(f.nodes.get('email').disabled,true);assert.equal(warned(f),false);
});

test('changed reviewed visibility and unavailable dialog support never send an invitation',async()=>{
  const f=await users(),{nodes}=f,count=f.calls.length;const pending=nodes.get('invite').onclick();nodes.get('see-work').checked=false;nodes.get('see-work').onchange();nodes.get('review-approve').onclick();await pending;assert.equal(f.calls.length,count);assert.match(nodes.get('notice').textContent,/changed/);assert.equal(warned(f),true);
  const unsupported=await users();unsupported.nodes.get('invitation-review').showModal=null;unsupported.window.confirm=()=>{throw Error('Must fail closed without browser confirmation');};const calls=unsupported.calls.length;await unsupported.nodes.get('invite').onclick();assert.equal(unsupported.calls.length,calls);assert.match(unsupported.nodes.get('notice').textContent,/review could not open/);
});

test('Sales section labels use normal names while contributor labels keep assigned wording',async()=>{
  const f=await users();f.payload.sections.push({id:'sops',label:'Assigned SOPs',editable:false},{id:'meetings',label:'Assigned meetings',editable:false});f.payload.sections.find(s=>s.id==='clients').label='Assigned clients';f.payload.sections.find(s=>s.id==='calls').label='Assigned calling list';f.context.review.render(f.payload.users[0]);
  const label=id=>f.nodes.get('see-'+id).isConnected&&f.nodes.get('sections').children.find(row=>row.children[0].children[0].id==='see-'+id).children[0].children[1].textContent;
  assert.equal(label('clients'),'Assigned clients');assert.equal(label('calls'),'Assigned calling list');f.nodes.get('profile').value='sales_associate';f.nodes.get('profile').onchange();assert.equal(label('clients'),'Clients');assert.equal(label('calls'),'Calls');assert.equal(label('sops'),'SOPs');assert.equal(label('meetings'),'Meetings');f.nodes.get('profile').value='contributor';f.nodes.get('profile').onchange();assert.equal(label('meetings'),'Assigned meetings');
});

test('invitation markup declares its accessible review and preserves dirty-leave browser confirmation',()=>{
  const html=source('users.html');assert.match(html,/<dialog id="invitation-review" aria-labelledby="review-title" aria-describedby="review-action">/);assert.match(html,/id="review-cancel" type="button" autofocus/);assert.match(html,/id="review-approve" type="button" class="primary"/);assert.match(source('users.js'),/window\.confirm\('Leave without saving these visibility changes\?'\)/);assert.doesNotMatch(source('users.js'),/window\.confirm\([^\n]*Approve CRM sign-in/);
});

test('embedded dirty changes are sent immediately and duplicate unchanged messages are suppressed',()=>{
  const fixture=surface();let dirty=false;fixture.window.sereneEmbeddedDirty=()=>dirty;fixture.context.ResizeObserver=class{observe(){}};vm.runInContext(source('embedded.js'),fixture.context);
  assert.equal(fixture.messages.at(-1).message.dirty,false);const count=fixture.messages.length;fixture.window.sereneEmbeddedChanged();assert.equal(fixture.messages.length,count);
  dirty=true;fixture.window.sereneEmbeddedChanged();assert.equal(fixture.messages.at(-1).message.dirty,true);dirty=false;fixture.window.sereneEmbeddedChanged();assert.equal(fixture.messages.at(-1).message.dirty,false);
});
