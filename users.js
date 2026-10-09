(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, text) => { const e = document.createElement(tag); if (text != null) e.textContent = text; return e; };
  let data, selected = null, busy = false, dirty = false, lockedControls = null, baseline = '', inviteReview = null;
  const salesSections = ['contacts','pipeline','calls'];
  const contributorDefaults = ['today','calendar','clients','work','tickets','activity'];
  const salesSectionLabel = section => ({clients:'Clients',calls:'Calls',sops:'SOPs',meetings:'Meetings'}[section.id] || section.label.replace(/^Assigned\s+/i, '').replace(/^./, char => char.toUpperCase()));
  const changed = () => window.sereneEmbeddedChanged?.();
  function draft() {
    return JSON.stringify({name:$('name')?.value.trim() || '',email:($('email')?.value || '').trim().toLowerCase(),status:$('status')?.value || '',profile:$('profile')?.value || 'contributor',scope:$('scope')?.value || 'assigned',invite:!!$('invite-new')?.checked,sections:(data?.sections || []).filter(section => $('see-' + section.id)?.checked).map(section => section.id).sort(),editSections:(data?.sections || []).filter(section => $('edit-' + section.id)?.checked).map(section => section.id).sort()});
  }
  function syncDirty() { dirty = !!baseline && draft() !== baseline; return dirty; }
  window.sereneEmbeddedDirty=()=>syncDirty()||busy;
  const labels = {sent:'Invitation sent',pending:'Waiting to send',access_ready:'Sign-in approved',sending:'Email delivery unconfirmed',send_unknown:'Email delivery unconfirmed',failed:'Invitation needs retry',disabled:'Sign-in approval removed'};
  function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
  function notifyUsers() { if (window.parent !== window) window.parent.postMessage({type:'serene-users-updated'}, location.origin); }
  async function api(path = '', method = 'GET', body) {
    const response = await fetch('/api/users' + path, {method, credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:body ? JSON.stringify(body) : undefined});
    if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Your session could not be verified. Refresh the CRM and sign in again.');
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'User settings could not be saved. Try again.');
    return value;
  }
  function canLeave() { return !busy && !inviteReview && (!syncDirty() || window.confirm('Leave without saving these visibility changes?')); }
  function markDirty() { notice(syncDirty() ? 'Changes have not been saved. Save before sending an invitation.' : 'Your entries match the saved visibility.'); changed(); }
  function highlightSelection() {
    for (const button of $('users').querySelectorAll('button')) {
      const active = button.dataset.userId === selected?.id;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
  }
  function lockControls() {
    if (!busy || !lockedControls) return;
    for (const control of document.querySelectorAll('button,input,select,textarea')) {
      if (!lockedControls.has(control)) lockedControls.set(control, control.disabled);
      control.disabled = true;
    }
  }
  async function load(notify = true) {
    data = await api(); $('users').replaceChildren();
    for (const user of data.users) {
      const button = el('button', user.name);
      button.type = 'button'; button.className = 'contact'; button.dataset.userId = user.id;
      button.append(el('small', user.isPrimaryOwner ? 'Primary owner · protected access' : user.profile==='administrator' ? 'Administrator · full CRM · '+user.status : user.profile === 'sales_associate' ? 'Sales associate · ' + (user.scope === 'all_sales' ? 'All sales records' : 'Assigned sales records') + ' · ' + user.status : 'Assigned visibility · ' + user.status));
      if (user.invitation_status) button.append(el('small', labels[user.invitation_status] || 'Invitation pending'));
      button.onclick = () => { if (canLeave()) render(user); }; $('users').append(button);
    }
    if (!data.users.length) $('users').append(el('p', 'No team accounts are available.'));
    $('new').disabled = false; highlightSelection(); lockControls();
    if (notify) notifyUsers();
  }
  async function action(fn, message) {
    if (busy) return; busy = true;
    lockedControls = new Map(); lockControls(); $('user-form')?.setAttribute('aria-busy', 'true');
    if (message) notice(message);
    try { await fn(); } catch (error) { notice(error.message, true); }
    finally { busy = false; lockedControls.forEach((disabled, control) => { if (control.isConnected) control.disabled = disabled; }); lockedControls = null; $('user-form')?.removeAttribute('aria-busy'); changed(); }
  }
  async function confirmInvite(user, {newAccount = false, accessOnly = false} = {}) {
    if (busy || inviteReview) return false;
    const dialog = $('invitation-review'), approve = $('review-approve'), cancel = $('review-cancel'), duplicate = $('review-duplicate');
    if (!dialog?.showModal || !user?.email) { notice('The invitation review could not open. Refresh the CRM before trying again.', true); return false; }
    const resend = !accessOnly && ['sent','sending','send_unknown'].includes(user.invitation_status);
    const uncertain = !accessOnly && ['sending','send_unknown'].includes(user.invitation_status);
    const focused = document.activeElement;
    $('review-title').textContent = accessOnly ? 'Review administrator access' : resend ? 'Review invitation resend' : 'Review login invitation';
    $('review-action').textContent = accessOnly ? (newAccount?'Create this account and grant':'Grant')+' full administrator access to the person below. No invitation email is sent by this action.' : newAccount ? 'Create this account, save the access below, approve CRM sign-in and send login instructions to this recipient.' : 'Approve CRM sign-in and ' + (resend ? 'resend' : 'send') + ' login instructions to this recipient. Their saved access below will apply.';
    $('review-name').textContent = user.name || 'New team member'; $('review-email').textContent = user.email;
    $('review-profile').textContent = user.profile==='administrator'?'Administrator':user.profile === 'sales_associate' ? 'Sales associate' : 'Assigned contributor';
    $('review-scope').textContent = user.profile==='administrator'?'Full CRM workspace':user.profile === 'sales_associate' && user.scope === 'all_sales' ? 'All active sales contacts and deals' : 'Assigned records only';
    $('review-sections').replaceChildren();
    if(user.profile==='administrator')for(const label of ['All contacts, deals and call records','Financial information, private notes, audits and documents','Operations, team assignments, calendars and reports','Connected CRM mail and user administration','Ibrar’s primary owner account stays protected'])$('review-sections').append(el('li',label));
    for (const section of user.profile==='administrator'?[]:data.sections.filter(section => (user.sections || []).includes(section.id))) {
      const mayEdit = (user.editSections || []).includes(section.id);
      $('review-sections').append(el('li', (user.profile === 'sales_associate' ? salesSectionLabel(section) : section.label) + ' — ' + (mayEdit ? section.id === 'calls' ? 'may place calls and record outcomes' : 'may update' : 'view only')));
    }
    if (user.profile!=='administrator'&&!(user.sections || []).length) $('review-sections').append(el('li', 'No CRM sections selected'));
    $('review-warning').hidden = !resend;
    $('review-warning').textContent = uncertain ? 'Email delivery is unconfirmed. Check Sent mail before resending to avoid duplicate login instructions.' : 'An invitation was already sent. Confirm that you want to send the login instructions again.';
    $('review-duplicate-label').hidden = !uncertain; duplicate.checked = false; approve.disabled = uncertain;
    approve.textContent = accessOnly ? 'Approve administrator access' : resend ? 'Approve and resend invitation' : newAccount ? 'Create account and send invitation' : 'Approve and send invitation';
    duplicate.onchange = () => { approve.disabled = uncertain && !duplicate.checked; };
    return new Promise(resolve => {
      let settled = false;
      const finish = approved => {
        if (settled || approved && uncertain && !duplicate.checked) return;
        settled = true; inviteReview = null; approve.disabled = true;
        if (dialog.open) dialog.close();
        focused?.isConnected && focused.focus?.(); resolve(approved);
      };
      inviteReview = {finish}; approve.onclick = () => finish(true); cancel.onclick = () => finish(false);
      dialog.oncancel = event => { event.preventDefault(); finish(false); }; dialog.onclose = () => finish(false);
      try { dialog.showModal(); cancel.focus(); }
      catch { finish(false); notice('The invitation review could not open. Refresh the CRM before trying again.', true); }
    });
  }
  async function send(user) {
    if (syncDirty()) { notice('Save these visibility changes before sending an invitation.', true); return; }
    const approvedDraft = draft();
    if (busy || !await confirmInvite(user)) return;
    if (busy || selected?.id !== user.id || draft() !== approvedDraft) { notice('The selected account or visibility changed. Review the invitation again before sending.', true); return; }
    await action(async () => {
      const result = await api('/' + encodeURIComponent(user.id) + '/invite', 'POST', {resend:['sent','sending','send_unknown'].includes(user.invitation_status)});
      notifyUsers(); await load(false); render(data.users.find(x => x.id === user.id)); notice(result.accessNotice || 'Invitation request completed.', !result.ok);
    }, 'Approving sign-in and preparing login instructions…');
  }
  function render(user) {
    const primary=!!(user?.isPrimaryOwner??(user?.isOwner&&user?.profile!=='administrator')),self=!!user&&user.id===data.actorId;
    selected = user; dirty = false; $('detail').replaceChildren($('user-template').content.cloneNode(true));
    $('name-title').textContent = user?.name || 'Add and invite a user';
    $('name').value = user?.name || ''; $('email').value = user?.email || ''; $('status').value = user?.status || 'active';
    $('profile').value = primary?'contributor':user?.profile || 'contributor'; $('scope').value = user?.scope || 'assigned'; $('profile-panel').hidden = primary;
    $('name').disabled = !!user; $('email').disabled = !!user; $('status').disabled = !user;
    $('identity-help').textContent = user ? 'Existing names and sign-in emails are fixed to preserve record assignments.' : 'Use the email this person will use to sign in. New users start as active accounts.';
    $('invite-new').checked = !user && data.invitationReady; $('invite-new').disabled = !data.invitationReady; $('invite-new-label').hidden = !!user;
    $('invite').hidden = !user || primary || self || user.status !== 'active'; $('invite').disabled = !data.invitationReady;
    $('invite').textContent = ['sent','sending','send_unknown'].includes(user?.invitation_status) ? 'Resend invitation' : 'Send invitation'; $('invite').onclick = () => send(user);
    $('invitation-status').textContent = user?.invitation_status === 'sent' && user?.sent_at ? 'Invitation sent ' + new Date(user.sent_at).toLocaleString() : labels[user?.invitation_status] || 'No invitation sent yet.';
    $('invite-help').textContent = user?.status==='disabled' ? 'This account cannot access CRM data. Activate and save it before sending a new invitation.' : user?.invitation_status==='disabled' ? 'The account is active again. Send a new invitation to restore its managed sign-in approval.' : data.invitationReady ? 'Invitations approve sign-in and email a CRM link. Save visibility changes before inviting an existing user.' : 'Automatic invitations need a one-time connection. Accounts can still be saved without sending.';
    $('mail-preview').textContent = 'Subject: Your Serene Ops CRM access\n\nWelcome to Serene Ops. Open ' + data.loginUrl + '. Sign in using the email on this account and follow the method shown. Your workspace uses the access approved for your role by your CRM administrator.';
    const initialProfile=user?.profile || 'contributor',initialScope=user?.scope || 'assigned';
    const initialSections=user?.sections || contributorDefaults,initialEdits=user?.editSections || [];
    const sectionLabels=new Map(),editLabels=new Map(),rows=new Map();
    for (const section of data.sections) {
      const wrap = el('div'); wrap.className = 'service'; const label = el('label'); label.className = 'check';
      const check = el('input'); check.type = 'checkbox'; check.id = 'see-' + section.id;
      check.checked = user?.isOwner || user?.sections.includes(section.id) || (!user && ['today','calendar','clients','work','tickets','activity'].includes(section.id));
      const sectionText=el('span',section.label); sectionLabels.set(section.id,sectionText); rows.set(section.id,wrap);
      label.append(check, sectionText); wrap.append(label); check.onchange = markDirty;
      if (section.editable) {
        const editLabel = el('label'); editLabel.className = 'check small'; const edit = el('input'); edit.type = 'checkbox'; edit.id = 'edit-' + section.id; edit.checked = !!user?.isOwner || user?.editSections.includes(section.id) || false;
        const editText=el('span');editLabels.set(section.id,editText);editLabel.append(edit, editText); wrap.append(editLabel);
        check.onchange = () => { if (!check.checked) edit.checked = false; markDirty(); };
        edit.onchange = () => { if (edit.checked) check.checked = true; markDirty(); };
      }
      $('sections').append(wrap);
    }
    function updateProfileUI(reset = false) {
      if(primary){$('scope').disabled=true;$('visibility-help').textContent='Ibrar has protected primary ownership and full CRM access.';return;}
      if($('profile').value==='administrator'){$('scope').value='all';$('scope').disabled=true;$('scope-help').textContent='Administrators have full access to the CRM. This does not add them to the Cloudflare infrastructure account.';$('visibility-help').textContent='Full access includes contacts, sales, calls, finance, private notes, audits, documents, connected mail, operations, team records and user administration. Ibrar’s primary owner account stays protected.';for(const section of data.sections){$('see-'+section.id).checked=true;$('see-'+section.id).disabled=true;const edit=$('edit-'+section.id);if(edit){edit.checked=true;edit.disabled=true;}rows.get(section.id).style.opacity='1';sectionLabels.get(section.id).textContent=salesSectionLabel(section);if(editLabels.has(section.id))editLabels.get(section.id).textContent='Administrator access';}return;}
      const sales=$('profile').value==='sales_associate';
      if(!sales)$('scope').value='assigned';
      $('scope').disabled=!sales;
      $('scope-help').textContent=sales ? 'All sales records includes every active contact and deal. Assigned limits sales records to this person’s assignments.' : 'Contributors work with assigned records in the sections you choose.';
      $('visibility-help').textContent=sales ? ($('scope').value==='all_sales' ? 'This sales associate can access all contacts and deals in the chosen sales sections.' : 'This sales associate can access assigned contacts and deals in the chosen sales sections.') + ' Financial details, private notes and user administration require administrator access.' : 'Access is limited to assigned records. Viewing a section does not grant access to all clients or other users.';
      for(const section of data.sections){
        const see=$('see-'+section.id),edit=$('edit-'+section.id),allowed=sales?salesSections.includes(section.id):section.id!=='pipeline';
        const editable=allowed&&(sales?salesSections.includes(section.id):['calls','work','tickets','social'].includes(section.id));
        if(reset){const restoring=$('profile').value===initialProfile;see.checked=(restoring?initialSections:sales?salesSections:contributorDefaults).includes(section.id);if(edit)edit.checked=(restoring?initialEdits:sales?salesSections:[]).includes(section.id);}
        if(!allowed){see.checked=false;if(edit)edit.checked=false;}
        if(edit&&!editable)edit.checked=false;
        see.disabled=primary||!allowed;if(edit)edit.disabled=primary||!editable;
        rows.get(section.id).style.opacity=allowed?'1':'.5';
        const label=sales?salesSectionLabel(section):section.label;
        sectionLabels.get(section.id).textContent=label;
        if(editLabels.has(section.id))editLabels.get(section.id).textContent=section.id==='calls'?'May place calls and record outcomes':sales?'May update sales '+label.toLowerCase():'May update assigned '+label.toLowerCase();
      }
    }
    $('profile').onchange=()=>{$('scope').value=$('profile').value===initialProfile?initialScope:'assigned';updateProfileUI(true);markDirty();};
    $('scope').onchange=()=>{updateProfileUI();markDirty();};
    updateProfileUI();
    $('name').oninput = markDirty; $('email').oninput = markDirty; $('status').onchange = markDirty; $('invite-new').onchange = markDirty;
    if (primary||self) { $('user-form').querySelectorAll('input,select,button').forEach(control => { control.disabled = true; }); $('invitation-panel').hidden = true; notice(primary?'Ibrar’s primary owner access is fixed.':'Ask another administrator to change your own account access.'); }
    else notice(user ? 'Review assigned visibility and save any changes.' : 'Choose the sections this user needs, then save or invite.');
    baseline = draft(); highlightSelection(); lockControls(); changed();
    $('user-form').onsubmit = async event => {
      event.preventDefault(); if (busy || inviteReview || primary||self) return;
      const invite = !user && $('invite-new').checked;
      const input = {name:$('name').value.trim(),email:$('email').value.trim(),status:$('status').value,profile:$('profile').value,scope:$('scope').value,invite,sections:data.sections.filter(s => $('see-' + s.id).checked).map(s => s.id),editSections:data.sections.filter(s => $('edit-' + s.id)?.checked).map(s => s.id)};
      const approvedDraft = draft();
      const grantingAdministrator=input.profile==='administrator'&&user?.profile!=='administrator';
      if ((invite||grantingAdministrator) && !await confirmInvite(input, {newAccount:!user,accessOnly:!invite})) return;
      if(grantingAdministrator)input.administratorAcknowledged=true;
      if (busy || draft() !== approvedDraft || selected?.id !== user?.id) { notice('The account or visibility changed. Review it again before saving.', true); return; }
      await action(async () => {
        const result = await api(user ? '/' + encodeURIComponent(user.id) : '', user ? 'PUT' : 'POST', input); dirty = false; notifyUsers();
        // Lock a newly saved identity even if refreshing the team list fails.
        const saved = {...user,...input,id:result.id,isOwner:input.profile==='administrator',isPrimaryOwner:false,invitation_status:result.invitationStatus || user?.invitation_status}; render(saved);
        try { await load(false); render(data.users.find(x => x.id === result.id) || saved); }
        catch { notice((result.accessNotice || 'Account and visibility saved.') + ' The team list could not refresh. Reload the page to check it.', true); return; }
        notice(result.accessNotice || 'Account and visibility saved.', !result.ok);
      }, invite ? 'Saving access and preparing the invitation…' : 'Saving user and visibility…');
    };
  }
  $('new').onclick = () => { if (data && canLeave()) render(null); };
  window.addEventListener('beforeunload', event => { if (syncDirty() || busy) { event.preventDefault(); event.returnValue = ''; } });
  load().then(() => notice(data.invitationReady ? 'CRM administrators can invite users and manage visibility. Ibrar’s primary owner access is protected.' : 'User management is ready. Automatic invitations still need setup.')).catch(error => notice(error.message, true));
})();
