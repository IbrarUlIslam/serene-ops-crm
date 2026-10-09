const fs=require('fs');
function integrateCallQueue(template){
 if(template.includes('// Assigned next-to-call integration v1.'))return template;
 const replace=(before,after)=>{if(!template.includes(before))throw Error('Missing calling-list anchor: '+before.slice(0,100));template=template.replace(before,after);};
 replace("{k:'callable_clients', name:'Clients callable now', why:'Inside their working hours, weekdays only.'}","{k:'next_to_call', name:'Next to call', why:'Inactive clients and due callbacks, ordered by availability. Their local time and your PKT time.'}");
 replace("const queues=this.QUEUE_RULES.map(q=>{\n      const n=this.queueMembers(q.k, X).length;",`const queues=this.QUEUE_RULES.map(q=>{
      if(q.k==='next_to_call')return {name:q.name,why:q.why,count:'',has:true,empty:false,custom:false,label:'Open call list',countStyle:'display:none',btnStyle:'padding:9px 15px;border:0;border-radius:2px;background:var(--action);color:var(--on-action);font-size:13px;font-weight:600;cursor:pointer',go:()=>this.go('callqueue')};
      const n=this.queueMembers(q.k, X).length;`);
 // Staff never receive the administrator's legacy call queues or shared ledger.
 replace("canView(view){if(!this.workspaceReady())return false;if(!this.isContributor())return true;const sections=", "canView(view){if(view==='callqueue')view='calls';if(!this.workspaceReady())return false;if(!this.isContributor())return true;const sections=");
 replace("  go(view, extra){\n    if(!this.canView(view))", "  go(view, extra){\n    if(view==='calls'&&this.isContributor())view='callqueue';\n    if(!this.canView(view))");
 replace("['social','Social planner',null],['sops','SOPs',null],['activity','My activity',null]", "['social','Social planner',null],['sops','SOPs',null],['calls','Assigned calling list',null],['activity','My activity',null]");
 replace("const on = s.view===id || (id==='contacts'&&s.view==='contact');", "const on = s.view===id || (id==='contacts'&&s.view==='contact') || (id==='calls'&&s.view==='callqueue');");
 replace("const titles={users:","const titles={callqueue:['Next to call','Reach inactive clients during their available hours.'],users:");
 replace("vCalls:this.canView('calls')&&s.view==='calls'", "vCallQueue:this.canView('calls')&&(s.view==='callqueue'||(contributor&&s.view==='calls')), callQueueFrameUrl:'/call-queue.html?embedded=1', vCalls:this.canView('calls')&&s.view==='calls'&&!contributor");
 replace('<sc-if value="{{ vCalls }}">','<sc-if value="{{ vCallQueue }}"><iframe src="{{ callQueueFrameUrl }}" title="Next to call" style="width:100%;height:calc(100vh - 190px);min-height:650px;border:0;background:#FFFFFF"></iframe></sc-if>\n        <sc-if value="{{ vCalls }}">');
 replace("['/audits.html','/users.html'].includes(url.pathname)","['/audits.html','/users.html','/call-queue.html'].includes(url.pathname)");
 replace("else if(e.data.type==='serene-users-updated'",`else if(e.data.type==='serene-call-queue-call'&&new URL(frame.src,location.origin).pathname==='/call-queue.html')this.dispatchCallQueue(e.data,frame);
      else if(e.data.type==='serene-call-queue-updated'&&new URL(frame.src,location.origin).pathname==='/call-queue.html'){if(this.state.zoomActiveCall?.queue&&this.state.zoomActiveCall.contactId===e.data.contactId)this.setState({zoomActiveCall:null});this.refreshAuditDocuments();}
      else if(e.data.type==='serene-call-queue-discarded'&&new URL(frame.src,location.origin).pathname==='/call-queue.html'){if(this.state.zoomActiveCall?.queue&&this.state.zoomActiveCall.contactId===e.data.contactId)this.setState({zoomActiveCall:null});}
      else if(e.data.type==='serene-users-updated'`);
 replace("if(this.workspaceReady()&&accessUser.isOwner){this.refreshTeamRoster();this.zoomFetchPhoneMapping();this.zoomEnsureEmbed();this.zoomFetchCallsList();this.zohoFetchStatus();}","if(this.workspaceReady()&&accessUser.isOwner){this.refreshTeamRoster();this.zoomFetchPhoneMapping();this.zoomEnsureEmbed();this.zoomFetchCallsList();this.zohoFetchStatus();}else if(this.workspaceReady()&&this.canEditSection('calls'))this.zoomFetchPhoneMapping();");
 replace('  zoomMakeCall(rawNumber, contactId){',`  // Assigned next-to-call integration v1.
  async dispatchCallQueue(input,frame){
    const requestId=String(input.requestId||'').slice(0,120),contactId=String(input.contactId||'').slice(0,120),identity=this.state.accessUser?.id||this.state.accessUser?.email;
    const current=()=>this.workspaceReady()&&this.canView('calls')&&this.canEditSection('calls')&&['calls','callqueue'].includes(this.state.view)&&(this.state.accessUser?.id||this.state.accessUser?.email)===identity;
    const reply=(ok,error,extra={})=>frame.contentWindow?.postMessage({type:'serene-call-queue-call-result',requestId,contactId,ok,...extra,...(error?{error}:{})},location.origin);
    if(!requestId||!contactId)return reply(false,'Select a client before calling.');
    if(!current())return reply(false,'Calling is outside your current assigned access.');
    if(this._queueDispatchPending||this._zoomDispatchPending||this.state.zoomActiveCall)return reply(false,'A call is already in progress. Finish or log that call first.');
    this._queueDispatchPending=true;
    try{
      const post=async(path,body)=>{const response=await this.apiFetch(path,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error||value.reasons?.join(' ')||'The client is no longer available to call. Refresh the list.');return value;};
      const checked=await post('/api/call-queue/check',{contactId,inactivityDays:input.inactivityDays});
      if(!current())throw Error('Your calling access or selected screen changed. Refresh the list.');
      if(!checked.eligible||checked.contact?.contactId!==contactId||!checked.contact.phone||!checked.idempotencyKey)throw Error('The contact number could not be verified. Refresh the list.');
      const mappingResponse=await this.apiFetch('/api/zoom/phone-mapping',{credentials:'include'}),mapping=await mappingResponse.json();
      if(!mappingResponse.ok||!mapping.data)throw Error('Your Zoom Phone access needs to be connected by Ibrar before calling from the CRM. You can still record calls made outside the CRM.');
      if(!current())throw Error('Your calling access changed. Refresh the list.');
      // A fresh server check in this claim prevents stale windows, assignments
      // or contact numbers from reaching the desktop phone application.
      const claimed=await post('/api/zoom/calls/claim',{destNumber:checked.contact.phone,queueContactId:contactId,inactivityDays:input.inactivityDays});
      if(!current())throw Error('Your calling access changed. Refresh the list.');
      if(!claimed.data?.ok)throw Error('The call could not be prepared. Refresh the list.');
      const closesAt=Date.parse(claimed.data.closesAt||checked.contact.closesAt||'');
      if(!Number.isFinite(closesAt)||Date.now()>=closesAt)throw Error('The calling window just closed. Refresh to see the next client.');
      const dialNumber=String(checked.contact.phone).replace(/[^0-9+]/g,'');
      const uri='zoomphonecall://'+encodeURIComponent(dialNumber),link=document.createElement('a');link.href=uri;link.style.display='none';document.body.appendChild(link);
      this.setState({zoomActiveCall:{contactId,number:checked.contact.phone,status:'dialing',startedAt:Date.now(),via:'uri',queue:true}});
      try{link.click();}catch(error){this.setState({zoomActiveCall:null});throw error;}finally{setTimeout(()=>{try{document.body.removeChild(link);}catch{}},500);}
      setTimeout(()=>{if(this.state.zoomActiveCall?.queue&&this.state.zoomActiveCall.contactId===contactId&&this.state.zoomActiveCall.status==='dialing')this.setState({zoomActiveCall:null});},60000);
      reply(true,null,{idempotencyKey:checked.idempotencyKey,checkedAt:checked.checkedAt});
    }catch(error){reply(false,error.message||'The dial request failed. No call outcome was recorded.');}
    finally{this._queueDispatchPending=false;}
  }
  zoomMakeCall(rawNumber, contactId){`);
 return template;
}
function patchFile(path='index.html'){
 const raw=fs.readFileSync(path,'utf8'),pattern=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(pattern);if(!m)throw Error('CRM template missing');const template=integrateCallQueue(JSON.parse(m[2]));fs.writeFileSync(path,raw.replace(pattern,()=>m[1]+JSON.stringify(template).replace(/<\//g,'<\\/')+m[3]));
}
module.exports={integrateCallQueue,patchFile};
if(require.main===module){patchFile();console.log('Assigned next-to-call integration applied.');}
