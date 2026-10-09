const fs=require('fs');

function integrateStaffManualCalls(template){
 if(template.includes('// Staff manual call recording v1.'))return template;
 const replace=(before,after)=>{if(!template.includes(before))throw Error('Missing staff-call anchor: '+before.slice(0,120));template=template.replace(before,after);};
 replace("  endCallDialog(contactId, number){\n    this.setState({ modal:'callend', err:'', dialerOpen:false,", "  endCallDialog(contactId, number){\n    if(this.isContributor()&&!this.canEditSection('calls'))return this.toast('Call outcomes are read-only for your account.');\n    if(this._staffManualSaving||this._staffManualRetryPayload)return this.toast('Finish or retry the current call outcome first.');\n    this._staffManualAttemptKey=null;\n    this.setState({ modal:'callend', err:'', manualCallSaving:false,manualCallUncertain:false,dialerOpen:false,");
 replace("  logDialogCall(){\n    const d=this.state.draft||{};", "  logDialogCall(){\n    const d=this.state.draft||{};\n    if(this.isContributor())return this.saveStaffManualCall(d);");
 replace("  logManualCall(outcome){\n    const s=this.state, raw=(s.dialPad||'').replace(/\\D/g,'');", "  logManualCall(outcome){\n    const s=this.state, raw=(s.dialPad||'').replace(/\\D/g,'');\n    if(this.isContributor()){if(!this.canEditSection('calls'))return this.toast('Call outcomes are read-only for your account.');if(this._staffManualSaving||this._staffManualRetryPayload)return this.toast('Finish or retry the current call outcome first.');const match=s.dialerContactId?(s.db.contacts||[]).find(c=>c.id===s.dialerContactId):this.matchPhone(raw);if(!match)return this.toast('Choose a contact in your calling scope before recording an outcome.');this.endCallDialog(match.id,raw||match.phone||'');if(this.state.modal==='callend')this.setState({draft:{...this.state.draft,outcome,note:s.dialerNote||''}});return;}");
 replace("    if(this.isContributor()&&!['complete','views'].includes(kind)", "    if(kind==='callend'&&this.isContributor())return this.saveStaffManualCall(d);\n    if(this.isContributor()&&!['complete','views'].includes(kind)");
 replace("      title='Log the call'; sub=(who?who.name:this.prettyPhone(d.number))+' · what happened?'; cta='Save the call';\n      fields=[F('What happened','outcome','select',[''].concat(this.OUTCOMES.map(o=>o.k))),\n        F('Notes','note','area','','What was said, what you promised, what happens next','Saved to the contact record',true)];", "      title=this.isContributor()?'Record call outcome':'Log the call'; sub=(who?who.name:this.prettyPhone(d.number))+(this.isContributor()?' · Record a call already made. A phone connection is not required.':' · what happened?'); cta=s.manualCallSaving?'Saving call…':s.manualCallUncertain?'Retry the same call':'Save the call';\n      fields=[F('Outcome','outcome','select',[''].concat(this.OUTCOMES.map(o=>o.k))),F('Call notes','note','area','','What was said, what you promised, what happens next','Saved with this contact’s call outcome. Maximum 4,000 characters.',true)];\n      if(this.isContributor()&&['Connected','Call back later'].includes(d.outcome))fields.push(F('Callback date · PKT','callbackDate','text','','YYYY-MM-DD',d.outcome==='Call back later'?'Required for a requested callback.':'Optional if a callback was agreed.'),F('Callback time · PKT','callbackTime','text','','HH:mm','Pakistan time (UTC+05:00). Calling hours are checked before the next call.'));\n      if(s.manualCallSaving||s.manualCallUncertain)fields=fields.map(f=>({...f,disabled:true,onChange:()=>{}}));");
 replace("return{modalOpen:!!s.modal,modalTitle:title,modalSub:sub,modalCta:cta,modalFields:fields,modalErr:s.err||'',closeModal:()=>this.setState({modal:null,err:'',draft:{}}),saveModal:()=>this.saveModal(X)};", "return{modalOpen:!!s.modal,modalTitle:title,modalSub:sub,modalCta:cta,modalFields:fields,modalErr:s.err||'',modalSaving:s.modal==='callend'&&!!s.manualCallSaving,closeModal:()=>this.closeNativeModal(),saveModal:()=>this.saveModal(X)};");
 replace("if (e.key==='Escape' && this.state.modal) this.setState({modal:null, err:'', draft:{}});", "if (e.key==='Escape' && this.state.modal) this.closeNativeModal();");
 replace("if(this._saveEpoch>this._savedEpoch||this._embeddedDirty)","if(this._saveEpoch>this._savedEpoch||this._embeddedDirty||this._staffManualSaving||this._staffManualRetryPayload)");
 replace('<input value="{{ f.value }}" sc-camel-on-change="{{ f.onChange }}" placeholder="{{ f.ph }}" style=', '<input value="{{ f.value }}" sc-camel-on-change="{{ f.onChange }}" placeholder="{{ f.ph }}" disabled="{{ f.disabled }}" style=');
 replace('<textarea value="{{ f.value }}" sc-camel-on-change="{{ f.onChange }}" rows="3" placeholder="{{ f.ph }}" style=', '<textarea value="{{ f.value }}" sc-camel-on-change="{{ f.onChange }}" rows="3" placeholder="{{ f.ph }}" disabled="{{ f.disabled }}" style=');
 replace('<button type="button" sc-camel-on-click="{{ closeModal }}" style=', '<button type="button" sc-camel-on-click="{{ closeModal }}" disabled="{{ modalSaving }}" style=');
 replace('<button type="button" sc-camel-on-click="{{ saveModal }}" style=', '<button type="button" sc-camel-on-click="{{ saveModal }}" disabled="{{ modalSaving }}" style=');
 replace('  logDialogCall(){',`  // Staff manual call recording v1.
  closeNativeModal(){
    if(this.state.modal==='callend'&&(this._staffManualSaving||this._staffManualRetryPayload)){this.setState({err:this._staffManualSaving?'The call outcome is being saved.':'The previous save was not confirmed. Retry the same call outcome to confirm it before closing.'});return;}
    this._staffManualAttemptKey=null;this.setState({modal:null,err:'',draft:{},manualCallSaving:false,manualCallUncertain:false});
  }
  async saveStaffManualCall(d){
    if(this._staffManualSaving)return;
    const identity=this.state.accessUser?.id||this.state.accessUser?.email;
    const permitted=()=>this.workspaceReady()&&this.isContributor()&&this.canEditSection('calls')&&(this.state.accessUser?.id||this.state.accessUser?.email)===identity;
    if(!permitted())return this.setState({err:'Call outcomes are read-only or unavailable for your account.'});
    let payload=this._staffManualRetryPayload;
    try{
      if(!payload){
        const contact=(this.state.db.contacts||[]).find(c=>c.id===d.contact_id);
        if(!contact)throw Error('Choose a contact in your current calling scope.');
        const outcome=d.outcome,note=String(d.note||'').trim();
        if(!this.OUTCOMES.some(o=>o.k===outcome))throw Error('Choose what happened on the call.');
        if(note.length>4000)throw Error('Call notes must be 4,000 characters or fewer.');
        if(['Call back later','Wrong number','Do not call'].includes(outcome)&&!note)throw Error('Add a note explaining this outcome.');
        let callbackAt;const date=String(d.callbackDate||'').trim(),time=String(d.callbackTime||'').trim();
        if(['Connected','Call back later'].includes(outcome)&&(date||time||outcome==='Call back later')){
          if(!/^\\d{4}-\\d\\d-\\d\\d$/.test(date)||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(time))throw Error('Enter a callback date (YYYY-MM-DD) and time (HH:mm) in PKT.');
          const at=new Date(date+'T'+time+':00+05:00');if(!Number.isFinite(at.getTime()))throw Error('Enter a valid callback date and time.');
          if(at.getTime()<=Date.now()||at.getTime()>Date.now()+366*86400000)throw Error('Choose a future callback within the next year.');callbackAt=at.toISOString();
        }
        this._staffManualAttemptKey=this._staffManualAttemptKey||crypto.randomUUID();
        payload={contactId:contact.id,idempotencyKey:this._staffManualAttemptKey,outcome,note,...(callbackAt?{callbackAt}:{})};
      }
    }catch(error){this.setState({err:error.message});return;}
    this._staffManualSaving=true;this.setState({manualCallSaving:true,err:''});
    let submitted=false,saved=false;
    try{
      // Finish existing authorized contact edits before refreshing the snapshot.
      if(this._saveInFlight)throw Object.assign(Error('Contact changes are still saving. Try recording the call when they finish.'),{definite:true});
      if(this._saveEpoch>this._savedEpoch){await this.flushDb();if(this._saveEpoch>this._savedEpoch||this.state.saveError)throw Object.assign(Error('Save the pending contact changes before recording this call. Your outcome draft is retained.'),{definite:true});}
      if(!permitted())throw Object.assign(Error('Your calling access changed. Reload the CRM.'),{definite:true});
      submitted=true;
      const response=await this.apiFetch('/api/call-queue/outcome',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Your session could not confirm the call save. Sign in to the CRM again, then retry this same outcome.');
      const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'The call outcome could not be saved.'),{definite:response.status>=400&&response.status<500});
      if(result.ok!==true)throw Error('The call save was not confirmed.');
      saved=true;this._staffManualRetryPayload=null;this._staffManualAttemptKey=null;
      this.setState({modal:null,draft:{},err:'',manualCallUncertain:false,dialerNote:'',dialPad:'',dialerStage:'dial',dialerContactId:null});
      if(permitted())await this.refreshAuditDocuments();
      this.toast(result.duplicate?'This call outcome was already saved. No duplicate was created.':'Call outcome and notes saved.');
    }catch(error){
      if(saved){this.toast('The call outcome was saved. Refresh the CRM to see the latest record.');return;}
      if(submitted&&!error.definite)this._staffManualRetryPayload=payload;
      this.setState({manualCallUncertain:!!this._staffManualRetryPayload,err:error.message+(this._staffManualRetryPayload?' Retry preserves the same call identifier and notes.':'')});
    }finally{this._staffManualSaving=false;this.setState({manualCallSaving:false});}
  }
  logDialogCall(){`);
 return template;
}

function patchFile(path='index.html'){
 const raw=fs.readFileSync(path,'utf8'),pattern=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,match=raw.match(pattern);if(!match)throw Error('CRM template missing');
 const template=integrateStaffManualCalls(JSON.parse(match[2]));fs.writeFileSync(path,raw.replace(pattern,()=>match[1]+JSON.stringify(template).replace(/<\//g,'<\\/')+match[3]));
}
module.exports={integrateStaffManualCalls,patchFile};
if(require.main===module){patchFile();console.log('Staff manual call recording applied.');}
