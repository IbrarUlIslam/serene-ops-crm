(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node;};
  const outcomes=['Connected','Voicemail','No answer','Call back later','Wrong number','Do not call'];
  const embedded=window.parent!==window;
  let data=null,selected=null,version=null,verified=false,loading=false,saving=false,pendingCall=null,callTimer=null,dialSent=false,attemptKey=null,retryPayload=null,baseline='',selectedAvailable=false;
  const changed=()=>window.sereneEmbeddedChanged?.();
  const draft=()=>JSON.stringify({outcome:$('outcome').value,note:$('notes').value.trim(),callback:['Connected','Call back later'].includes($('outcome').value)?$('callback').value:''});
  const dirty=()=>!!selected&&draft()!==baseline;
  const pendingOutcome=()=>dirty()||dialSent||!!retryPayload;
  window.sereneEmbeddedDirty=()=>pendingOutcome()||saving||!!pendingCall;
  const rows=()=>data?[...data.available,...data.upcoming,...data.review]:[];
  const sales=()=>true;
  const noun=()=>sales()?'contact':'client';
  const isNow=row=>!!data?.available.some(item=>item.contactId===row.contactId);
  const canLog=()=>verified&&!!data?.canLog&&!selected?.reasonCodes?.includes('reserved')&&(selectedAvailable||dialSent||!!retryPayload);
  const nextAvailable=()=>{const available=data?.available||[],index=available.findIndex(row=>row.contactId===selected?.contactId);return index>=0?available[index+1]||null:available.find(row=>row.contactId!==selected?.contactId)||null;};
  const uuid=()=>crypto.randomUUID();
  function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
  function parseVersion(response,value){const supplied=value.snapshotVersion;if(supplied)return String(supplied).startsWith('"')?String(supplied):JSON.stringify(supplied);return String(response.headers.get('ETag')||'').replace(/^W\//,'')||null;}
  async function api(path='',method='GET',body,etag){
    const headers={'Content-Type':'application/json'};if(etag)headers['If-Match']=etag;
    const response=await fetch('/api/call-queue'+path,{method,credentials:'same-origin',headers,body:body?JSON.stringify(body):undefined});
    if(!response.headers.get('content-type')?.includes('application/json'))throw Object.assign(Error('Your session could not be verified. Refresh the CRM and sign in again.'),{uncertain:method==='POST'&&path==='/outcome'});
    const value=await response.json();
    if(!response.ok)throw Object.assign(Error(value.error||'The calling list could not complete this request.'),{status:response.status,uncertain:response.status>=500&&path==='/outcome'});
    return {value,version:parseVersion(response,value)};
  }
  function idle(){return !loading&&!saving&&!pendingCall;}
  function canLeave(){return idle()&&(!pendingOutcome()||confirm(dialSent?'Leave without recording the actual outcome of this dial request?':'Leave this unsaved call outcome?'));}
  function notifyDiscard(){if(embedded&&dialSent&&selected?.contactId)window.parent.postMessage({type:'serene-call-queue-discarded',contactId:selected.contactId},location.origin);}
  function draftChanged(){
    $('callback-field').hidden=$('outcome').value!=='Call back later'&&$('outcome').value!=='Connected';
    $('callback').required=$('outcome').value==='Call back later';
    $('draft-status').textContent=dirty()?'Outcome draft has not been saved.':dialSent?'The dial request was sent. Its actual outcome still needs recording.':'No outcome recorded.';
    $('discard').hidden=!pendingOutcome();$('discard').textContent=dialSent?'Discard pending outcome':'Discard draft';locks();changed();
  }
  function resetDraft(){
    $('outcome').value='';$('notes').value='';$('callback').value='';attemptKey=null;retryPayload=null;dialSent=false;baseline=draft();draftChanged();
  }
  function locks(){
    const blocked=!idle();$('reserve').hidden=!data?.reservationsEnabled||!selected||!isNow(selected)||!!selected?.reservedByMe;$('release').hidden=!data?.reservationsEnabled||!selected?.reservedByMe;$('reserve').disabled=blocked||!data?.canCall;$('release').disabled=blocked||pendingOutcome();$('refresh').disabled=blocked;$('inactivity').disabled=blocked;$('search').disabled=loading||saving;
    document.querySelectorAll('.queue-client').forEach(button=>button.disabled=blocked);
    $('next').disabled=blocked||!nextAvailable();
    $('dial').disabled=blocked||dialSent||dirty()||!!retryPayload||!embedded||!verified||!data?.canCall||!selectedAvailable||!selected||!isNow(selected);
    $('dial').textContent=pendingCall?'Requesting call…':dialSent?'Dial request sent':'Call '+noun();
    $('outcome').disabled=!canLog()||saving||!!pendingCall||!!retryPayload;
    $('notes').readOnly=!canLog()||saving||!!pendingCall||!!retryPayload;$('callback').readOnly=$('notes').readOnly;
    $('save').disabled=!canLog()||blocked;$('discard').disabled=blocked;
    $('stop-waiting').disabled=!pendingCall;
    $('outcome-form').setAttribute('aria-busy',String(saving));
  }
  function localTime(iso,zone){if(!iso)return null;try{const date=new Date(iso);if(Number.isNaN(date.getTime()))return null;return new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);}catch{return null;}}
  function inactivity(row){if(sales()&&row.firstSalesOutreach)return 'No meaningful contact recorded';return Number.isFinite(row.inactiveDays)?row.inactiveDays+' inactive '+(row.inactiveDays===1?'day':'days'):row.historyLabel||'Meaningful contact history unavailable';}
  function callback(row){if(!row.callbackAt)return '';const at=new Date(row.callbackAt).getTime(),now=new Date(data.serverNow).getTime();return at<=now?'Callback due':'Callback '+(localTime(row.callbackAt,'Asia/Karachi')||'scheduled');}
  function timing(row){if(isNow(row))return Number.isFinite(row.windowClosingMinutes)?'Closes in '+Math.max(0,Math.floor(row.windowClosingMinutes))+' min':row.closesPKT?'Closes '+row.closesPKT+' PKT':'Within calling hours';return row.opensPKT?'Opens '+row.opensPKT+' PKT':row.opensAt?'Opens '+localTime(row.opensAt,'Asia/Karachi'):(row.reasons||[]).join(' · ')||'Details need review';}
  function renderLists(){
    const query=$('search').value.trim().toLowerCase();
    for(const [bucket,target] of [['available','now'],['upcoming','later'],['review','review']]){
      const list=$(target+'-list');list.replaceChildren();const values=(data?.[bucket]||[]).filter(row=>row.name.toLowerCase().includes(query));$(target+'-count').textContent=values.length;
      for(const row of values){const button=el('button');button.type='button';button.className='queue-client';button.setAttribute('aria-pressed',String(selected?.contactId===row.contactId));button.append(el('strong',row.name),el('small',[inactivity(row),callback(row)].filter(Boolean).join(' · ')),el('small',timing(row)));button.onclick=()=>{if(canLeave()){select(row);notice('Review '+row.name+' before choosing the next step.');}};list.append(button);}
      if(!values.length){const empty=el('p',query?'No matching '+noun()+'s.':bucket==='available'?'No '+noun()+'s can be called now.':bucket==='upcoming'?'No later calling windows.':'No details need review.');empty.className='queue-list-empty';list.append(empty);}
    }
  }
  function fact(label,value,detail){const node=el('div');node.className='queue-fact';node.append(el('small',label),el('strong',value));if(detail)node.append(el('span',detail));$('client-facts').append(node);}
  function renderDetail(){
    $('empty-detail').hidden=!!selected;$('client-card').hidden=!selected;if(!selected){locks();changed();return;}
    $('client-name').textContent=selected.name;$('client-phone').textContent=selected.phone||'Phone number missing';
    const now=isNow(selected),review=!!data?.review.some(row=>row.contactId===selected.contactId);
    $('availability').textContent=selected.reservedByMe?'Reserved by you':!selectedAvailable?'No longer queued':now?'Available now':review?'Review details':'Available later';$('availability').className='queue-badge'+(now?' now':review?' review':'');
    $('client-facts').replaceChildren();if(sales())fact('Sales status',selected.status||'Not recorded');fact(sales()?'Contact history':'Meaningful inactivity',inactivity(selected),selected.lastMeaningfulAt?'Last meaningful contact '+(localTime(selected.lastMeaningfulAt,'Asia/Karachi')||selected.lastMeaningfulAt):selected.historyLabel||'A connected conversation or verified client interaction resets this clock.');
    fact(sales()?'Contact local time':'Client local time',selected.localNow||'Time zone needs review',selected.timezone||'No confirmed time zone');
    fact(now?'Window closes · PKT':'Next opening · PKT',now?(selected.closesPKT||localTime(selected.closesAt,'Asia/Karachi')||'Not available'):(selected.opensPKT||localTime(selected.opensAt,'Asia/Karachi')||'Not available'),now?(selected.closesLocal||localTime(selected.closesAt,selected.timezone)):(selected.opensLocal||localTime(selected.opensAt,selected.timezone)));
    fact('Callback',callback(selected)||'None scheduled',selected.callbackAt?localTime(selected.callbackAt,selected.timezone):null);
    fact('Last call attempt',selected.lastAttemptAt?(localTime(selected.lastAttemptAt,'Asia/Karachi')||selected.lastAttemptAt):'No recorded attempt','An attempt alone is not a meaningful conversation.');
    const reasons=(selected.reasons||[]).join(' ');$('next-step').textContent=!selectedAvailable?(dialSent?'This '+noun()+' is no longer in the refreshed queue. Record the actual outcome of the completed call, or explicitly discard the pending outcome.':'This '+noun()+' is no longer in the refreshed queue. Copy or discard your draft before choosing another '+noun()+'.'):review?(reasons||'Confirm the phone number and time zone before calling.'):now?(callback(selected).startsWith('Callback due')?'The callback is due and the '+noun()+' is within calling hours. Review the context, then call.':selected.firstSalesOutreach?'The prospect is within calling hours. Review the context and recorded attempts, then make a sales call.':'The '+noun()+' is within calling hours. Review the context, then make a call.'):(reasons||'Wait until the next opening before placing a call.');
    if(selected.reservedUntil)fact('Reservation',selected.reservedByMe?'Reserved by you':'Reserved by another associate','Expires '+localTime(selected.reservedUntil,'Asia/Karachi'));
    $('call-help').textContent=!data?.canCall?'Your access allows you to view this queue. Calling and logging require edit permission.':!embedded?'Open '+('Next to call')+' inside the CRM to use its phone connection. You can record a call made outside the CRM here.':dialSent?'The dial request was handed to the CRM phone. Confirm what happened and record the actual outcome.':'Calls begin only when you select Call '+noun()+'. Next '+noun()+' never starts a call. If your own CRM phone is not connected, make the call outside the CRM and log its actual outcome here.';
    draftChanged();locks();changed();
  }
  function select(row){notifyDiscard();selected=row;selectedAvailable=!!row;resetDraft();renderLists();renderDetail();}
  async function load({discard=false}={}){
    if(loading)return;loading=true;locks();const filter=$('inactivity').value,selectedId=selected?.contactId,preserve=pendingOutcome()&&!discard;
    try{
      const result=await api('?inactivityDays='+encodeURIComponent(filter));
      if(!Array.isArray(result.value.available)||!Array.isArray(result.value.upcoming)||!Array.isArray(result.value.review))throw Error('The queue response was incomplete. Refresh and try again.');
      data=result.value;version=result.version;verified=true;$('inactivity').value=String(data.inactivityDays);const refreshed=rows().find(row=>row.contactId===selectedId);
      $('queue-title').textContent='Next to call';document.title=$('queue-title').textContent+' | Serene Ops';$('queue-eyebrow').textContent='SERENE OPS / CALLING LIST';$('queue-description').textContent='All permitted contacts, ordered around their local calling hours. Schedule follow-ups using a reminder or task.';
      $('period-label').textContent='Contact activity';$('search-label').textContent='Find a '+noun();$('search').placeholder=(sales()?'Contact':'Client')+' name';$('detail-eyebrow').textContent='CONTACT';$('detail').setAttribute('aria-label','Selected '+noun());$('next').textContent='Next '+noun();$('empty-detail').textContent='Choose a '+noun()+' to review their calling window and next step.';
      $('queue-list').setAttribute('aria-label','Calling list');$('callback-hint').textContent='The queue checks the '+noun()+'’s calling hours before a future call.';
      $('scope').textContent=(data.canCall?(sales()?(['all_sales','all_contacts'].includes(data.contactScope)?'All permitted contacts appear.':'Only your assigned contacts appear.'):'Only your permitted active clients appear.'):'View only · calling and logging are unavailable with your current access.')+' Follow-ups are scheduled with reminders or tasks.';
      $('coverage').textContent=(data.historyCoverage?.label||'Meaningful follow-up uses recorded conversations and verified client interactions.')+(sales()?' First recorded prospect outreach is not delayed by contact creation. Subsequent meaningful contact respects the selected spacing.':' A missed call does not reset the inactivity clock.');
      if(preserve){if(refreshed)selected=refreshed;selectedAvailable=!!refreshed;renderLists();renderDetail();}
      else select(refreshed||data.available[0]||data.upcoming[0]||data.review[0]||null);
      notice(preserve?(dialSent?'Queue refreshed. Record the actual outcome of the existing dial request.':'Queue refreshed. Your outcome draft is retained.'):rows().length?'Choose a '+noun()+', review the calling window, then call or record an actual outcome.':sales()?'No contacts meet this calling list’s criteria.':'No active clients meet this queue’s follow-up criteria.');return true;
    }catch(error){verified=false;if(data)$('inactivity').value=String(data.inactivityDays);notice(error.message,true);return false;}
    finally{loading=false;locks();changed();}
  }
  function startCall(){
    if(!idle()||$('dial').disabled||!selected)return;
    const requestId=uuid();pendingCall={requestId,contactId:selected.contactId};$('stop-waiting').hidden=true;locks();changed();notice('Checking this '+noun()+' and the CRM phone before calling…');
    window.parent.postMessage({type:'serene-call-queue-call',requestId,contactId:selected.contactId,inactivityDays:Number($('inactivity').value)},location.origin);
    callTimer=setTimeout(()=>{if(pendingCall?.requestId!==requestId)return;$('stop-waiting').hidden=false;notice('No confirmation has returned yet. Check the CRM phone before retrying; this screen is still waiting.',true);},30000);
  }
  function receiveCall(event){
    if(event.origin!==location.origin||event.source!==window.parent||!pendingCall)return;
    const result=event.data;if(result?.type!=='serene-call-queue-call-result'||result.requestId!==pendingCall.requestId||result.contactId!==pendingCall.contactId)return;
    clearTimeout(callTimer);pendingCall=null;$('stop-waiting').hidden=true;
    if(result.ok===true){dialSent=true;attemptKey=result.idempotencyKey||null;notice('Dial request sent to the CRM phone. Record the actual result; no Connected outcome has been assumed.');}
    else notice(result.error||'The call could not start. Refresh the queue and check the CRM phone.',true);
    renderDetail();changed();
  }
  function callbackISO(){const raw=$('callback').value;if(!raw)return undefined;const date=new Date((raw.length===16?raw+':00':raw)+'+05:00');if(Number.isNaN(date.getTime()))throw Error('Choose a valid callback date and time in PKT.');return date.toISOString();}
  async function saveOutcome(event){
    event.preventDefault();if(!idle()||!canLog()||!selected)return;
    if(!$('outcome-form').reportValidity())return;
    let payload;
    try{
      if(retryPayload)payload=retryPayload;
      else{const outcome=$('outcome').value,note=$('notes').value.trim();if(['Call back later','Wrong number','Do not call'].includes(outcome)&&!note)throw Error('Add a note explaining the callback or contact detail change.');const callbackAt=callbackISO();if(outcome==='Call back later'&&!callbackAt)throw Error('Choose the callback date and time in PKT.');attemptKey=attemptKey||uuid();payload={contactId:selected.contactId,idempotencyKey:attemptKey,outcome,note,callbackAt:['Connected','Call back later'].includes(outcome)?callbackAt:undefined,inactivityDays:Number($('inactivity').value)};}
    }catch(error){notice(error.message,true);return;}
    saving=true;locks();changed();notice('Saving the call outcome…');
    try{
      const result=await api('/outcome','POST',payload,version);if(result.value.updatedAt)version=JSON.stringify(result.value.updatedAt);
      retryPayload=null;dialSent=false;baseline=draft();draftChanged();if(embedded)window.parent.postMessage({type:'serene-call-queue-updated',contactId:payload.contactId},location.origin);
      saving=false;const refreshed=await load({discard:true});notice((result.value.duplicate?'This outcome was already saved. No duplicate call record was created.':'Call outcome saved.')+(refreshed?' Choose the next '+noun()+' when you are ready.':' The queue could not refresh. Refresh before another action.'),!refreshed);
    }catch(error){
      if(error.status===409)notice(error.message+' Your draft is retained. Refresh the queue before retrying.',true);
      else{if(error.uncertain||!error.status)retryPayload=payload;notice(error.message+(retryPayload?' The save result is unconfirmed. Retry the same draft to confirm whether it was saved.':' Your draft is retained.'),true);}
    }finally{saving=false;locks();changed();}
  }
  for(const outcome of outcomes){const option=el('option',outcome);option.value=outcome;$('outcome').append(option);}
  $('outcome').onchange=draftChanged;$('notes').oninput=draftChanged;$('callback').oninput=draftChanged;
  $('outcome-form').onsubmit=saveOutcome;$('dial').onclick=startCall;$('search').oninput=()=>{renderLists();locks();};
  $('next').onclick=()=>{const next=nextAvailable();if(!next||!canLeave())return;select(next);notice('Review '+next.name+' before choosing the next step.');};
  $('refresh').onclick=()=>{if(idle())load();};
  $('inactivity').onchange=()=>{if(!idle())return;if(pendingOutcome()&&!confirm(dialSent?'Change the filter and leave without recording the actual outcome of this dial request?':'Change the inactivity filter and discard this outcome draft?')){$('inactivity').value=String(data.inactivityDays);return;}load({discard:true});};
  $('discard').onclick=()=>{if(!idle()||!pendingOutcome()||!confirm(retryPayload?'The previous save may have succeeded. Retrying this draft can confirm it first. Discard this local outcome draft?':dialSent?'Discard this pending outcome without recording what happened? This does not cancel the call.':'Discard this unsaved call outcome?'))return;notifyDiscard();resetDraft();renderDetail();notice('Local outcome draft discarded. No call record was changed.');};
  $('stop-waiting').onclick=()=>{if(!pendingCall||!confirm('Check the CRM phone first. Stop waiting here? This does not cancel a dial request that already reached the phone.'))return;clearTimeout(callTimer);pendingCall=null;$('stop-waiting').hidden=true;locks();changed();notice('Stopped waiting for confirmation. Check the phone before making another call.');};
  window.addEventListener('message',receiveCall);
  window.addEventListener('beforeunload',event=>{if(window.sereneEmbeddedDirty()){event.preventDefault();event.returnValue='';}});
  $('reserve').onclick=async()=>{if(!idle()||!selected||!canLeave())return;loading=true;locks();try{await api('/claim','POST',{contactId:selected.contactId,inactivityDays:Number($('inactivity').value)});loading=false;await load();notice('Reserved for 15 minutes. Make the call outside the CRM or use Call, then record the actual outcome.');}catch(error){notice(error.message,true);}finally{loading=false;locks();}};
  $('release').onclick=async()=>{if(!idle()||!selected||pendingOutcome())return;loading=true;locks();try{await api('/release','POST',{contactId:selected.contactId});loading=false;await load();notice('Reservation released.');}catch(error){notice(error.message,true);}finally{loading=false;locks();}};
  setInterval(()=>{if(!document.hidden&&idle()&&!pendingOutcome())load();},180000);
  resetDraft();load();
})();
