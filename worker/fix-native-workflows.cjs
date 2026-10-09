'use strict';

const fs = require('node:fs');
const path = require('node:path');

// This exports a pure patch for tests. Run explicitly to apply it to index.html.
function fixNativeWorkflowTemplate(input) {
  if (input.includes('// Native workflow consistency v1.')) return input;
  let source = input;
  function change(before, after) {
    if (!source.includes(before)) throw new Error('Missing native workflow patch anchor: ' + before.slice(0, 100));
    source = source.replace(before, after);
  }
  function guard(method, expression) {
    const re = new RegExp('(^  (?:async )?' + method + '\\([^\\n]*?\\)\\{)', 'm');
    if (!re.test(source)) throw new Error('Missing native workflow method: ' + method);
    source = source.replace(re, '$1' + expression);
  }
  function wrapContainer(marker, tag, condition) {
    const at=source.indexOf(marker);if(at<0)throw Error('Missing container marker: '+marker);
    const start=source.lastIndexOf('<'+tag,at);if(start<0)throw Error('Missing container: '+marker);
    const re=new RegExp('<\\/?'+tag+'\\b[^>]*>','g');re.lastIndex=start;let depth=0,end=-1,match;
    while((match=re.exec(source))){depth+=match[0].startsWith('</')?-1:1;if(depth===0){end=re.lastIndex;break;}}
    if(end<0)throw Error('Unclosed container: '+marker);
    source=source.slice(0,start)+'<sc-if value="{{ '+condition+' }}">'+source.slice(start,end)+'</sc-if>'+source.slice(end);
  }
  change("  isContributor(){ return !this.state.accessUser?.isOwner; }", `  isContributor(){ return !this.state.accessUser?.isOwner; }
  // Native workflow consistency v1.
  canEditSection(section){return !this.isContributor() || (this.canView(section) && (this.state.accessUser?.visibility?.editSections||[]).includes(section));}
  requireOwner(){if(!this.isContributor())return true;this.toast('Ibrar manages creating, assigning and archiving records.');return false;}
  requireSectionEdit(section){if(this.canEditSection(section))return true;this.toast('This section is read-only for your account.');return false;}
  completionEvidenceReady(id,note){const t=(this.state.db?.todos||[]).find(x=>x.id===id);if(!t||!t.evidence_required||String(note||t.completion_note||'').trim())return true;this.setState({modal:'complete',draft:{id,body:''},err:'Add the required evidence or completion note before completing this step.'});return false;}
  contactTabVisible(tab){if(!this.isContributor())return true;const sections={details:['contacts','clients'],work:['work'],tickets:['tickets'],files:['contacts','clients'],reminders:['calendar'],activity:['activity']};return (sections[tab]||[]).some(section=>this.canView(section));}`);

  change("const when=this.parseWhen((d.date||'')+(d.time?' '+d.time:''), 10);", "const when=this.dateTimeToUtc(d.date,d.time,tz,10);");
  change("  dateTimeToUtc(date,time,tz,defHour){const ds=(date||'').trim();if(!ds)return null;const tm=(time||'').trim()||String(defHour||17).padStart(2,'0')+':00';return this.zonedLocalToUtc(ds+' '+tm,tz||'UTC');}", `  dateTimeToUtc(date,time,tz,defHour){
    const ds=String(date||'').trim(),tm=String(time||'').trim()||String(defHour??17).padStart(2,'0')+':00',dm=ds.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/),hm=tm.match(/^(\\d{1,2}):([0-5]\\d)$/);
    if(!dm||!hm||Number(hm[1])>23)return null;
    const day=new Date(Date.UTC(+dm[1],+dm[2]-1,+dm[3]));if(day.getUTCFullYear()!==+dm[1]||day.getUTCMonth()!==+dm[2]-1||day.getUTCDate()!==+dm[3])return null;
    try{const zone=tz||'UTC',iso=this.zonedLocalToUtc(ds+' '+hm[1].padStart(2,'0')+':'+hm[2],zone);if(!iso)return null;const p=this.partsInTZ(new Date(iso),zone);return p.year===dm[1]&&p.month===dm[2]&&p.day===dm[3]&&Number(p.hour)===Number(hm[1])&&p.minute===hm[2]?iso:null;}catch{return null;}
  }`);
  change("if(kind==='bulkdealstage'){const ids=d.ids||[];this.commit(db=>ids.forEach(id=>{const x=db.deals.find(y=>y.id===id);if(x){x.stage=d.stage;x.updated_at=new Date().toISOString();}}),'Bulk deal stage changed');this.clearBulk('deals');this.setState({modal:null,draft:{}});return;}", `if(kind==='bulkdealstage'){
      const ids=d.ids||[],deals=ids.map(id=>X.db.deals.find(x=>x.id===id)).filter(Boolean),stage=d.stage;
      if(!this.STAGES.includes(stage))return this.setState({err:'Choose a valid stage.'});
      if(['Contract sent','Closed won'].includes(stage)&&deals.some(x=>!String(x.scope_agreed||'').trim()))return this.setState({err:'Record written scope on each selected deal before moving it to '+stage+'.'});
      if(stage==='Closed won'&&deals.some(x=>this.findSopInstance(X.db,'sop_acceptance',x.contact_id)?.status!=='Complete'))return this.setState({err:'Complete client acceptance for each selected deal before marking it Closed won.'});
      this.setState({modal:null,draft:{},err:''});ids.forEach(id=>this.moveDeal(id,stage));this.clearBulk('deals');return;
    }`);
  change("if(kind==='newdeal'){\n      const c=byName(d.contact);", "if(kind==='newdeal'){\n      if(['Contract sent','Closed won'].includes(d.stage))return this.setState({err:'Create the deal in an earlier stage, then complete written scope and acceptance before closing.'});\n      const c=byName(d.contact);");

  guard('toggleTodo', "if(!this.requireSectionEdit('work'))return;");
  guard('setOp', "if(!this.requireSectionEdit('work'))return;");
  guard('startTaskTimer', "if(!this.requireSectionEdit('work'))return;");
  guard('endTaskTimer', "if(!this.requireSectionEdit('work')||(complete&&!this.completionEvidenceReady(id,note)))return;");
  guard('setTicketStatus', "if(!this.requireSectionEdit('tickets'))return;");
  guard('publishSocial', "if(!this.requireSectionEdit('social'))return;");
  guard('moveDeal', 'if(!this.requireOwner())return;');
  for (const method of ['deleteContact','deleteFrom','openNewMeeting','openNewWork','openEditTask','ticketToWork','archiveOne','bulkArchive','bulkArchiveContacts','bulkPromptAssign','bulkPromptDue','bulkPromptTicketStatus','openBulkTag','skipSopTask','undoSkipSop','stepBackSop','openAddSopStep','openEditSopStep','removeSopStep','applySopTemplateChange','dropSopStep','dropCalendarDate','dropCalendarTime','addNoteFor']) guard(method,'if(!this.requireOwner())return;');
  guard('runAutomations','if(this.isContributor())return;');
  guard('openContact', "if(!this.canView('contact'))return;");
  guard('openDrawer', "if(!this.canView('contact'))return;");
  guard('openMeeting', "if(!this.canView('meetings'))return;");
  guard('auditForContact', 'if(!this.requireOwner())return;');
  guard('openQuickForRole', 'if(!this.requireOwner())return;');
  change("const s=this.state, d=s.draft||{}, kind=s.modal;", "const s=this.state, d=s.draft||{}, kind=s.modal;\n    if(this.isContributor()&&!['complete','views'].includes(kind))return this.setState({err:'Ibrar manages these changes.'});\n    if(kind==='complete'&&!this.canEditSection('work'))return this.setState({err:'Work items are read-only for your account.'});");

  // Staff submit only the permitted record edit. Successor tasks, SOP progress
  // and recurrence dates are derived by the server from the saved transition.
  source = source.replaceAll('this.completeSopStepDb(db,t);', 'if(!this.isContributor())this.completeSopStepDb(db,t);');
  source = source.replaceAll("this.advanceRecurringFromDb(db,t,'todos');", "if(!this.isContributor())this.advanceRecurringFromDb(db,t,'todos');");
  source = source.replaceAll('if(t.social_post_id){const p=', 'if(t.social_post_id&&!this.isContributor()){const p=');
  change("const linked=(db.todos||[]).filter(w=>w.ticket_id===id&&w.status==='Open'); if(v==='Assigned'", "const linked=this.isContributor()?[]:(db.todos||[]).filter(w=>w.ticket_id===id&&w.status==='Open'); if(!this.isContributor()&&v==='Assigned'");
  change("if(v==='Waiting on client feedback'){linked.forEach", "if(!this.isContributor()&&v==='Waiting on client feedback'){linked.forEach");

  change('const valid = tabDef.map(t=>t[0]);', 'const visibleTabDef=tabDef.filter(([tab])=>this.contactTabVisible(tab));\n    const valid = visibleTabDef.map(t=>t[0]);');
  change("const tab = valid.indexOf(s.tab)>-1 ? s.tab : 'details';", "const tab = valid.indexOf(s.tab)>-1 ? s.tab : (valid[0]||'details');");
  change('const tabs = tabDef.map(([k,label])=>', 'const tabs = visibleTabDef.map(([k,label])=>');
  change('canReport:isClient,', 'canReport:isClient&&!this.isContributor(),');
  change('canRemove:!f.audit_report_id,', 'canRemove:!this.isContributor()&&!f.audit_report_id,');
  change("if (isClient) detailSpec.push(['Monthly'", "if (isClient&&!this.isContributor()) detailSpec.push(['Monthly'");
  change("glance:glance.map(g=>Object.assign(g,", "glance:glance.filter(g=>!this.isContributor()||!['Monthly','Notice'].includes(g.k)).map(g=>Object.assign(g,");
  change('navGroups, zones, zonesBig, stats, me:this.me(),', "navGroups, zones, zonesBig, stats, me:this.me(), canManageRecords:!contributor, canShowWork:this.canView('work'), canShowCalendar:this.canView('calendar'), canShowDailyMeetings:this.canView('calendar')&&this.canView('meetings'), canUpdateWork:this.canEditSection('work'), workReadOnly:!this.canEditSection('work'), canUpdateTickets:this.canEditSection('tickets'), canUpdateSocial:this.canEditSection('social'),");
  change('const byId = {}; db.contacts.forEach(c=>byId[c.id]=c);', "const byId = {}; db.contacts.forEach(c=>byId[c.id]=this.isContributor()&&!this.canView('contact')?{id:c.id,name:'Assigned record'}:c);");
  change(".filter(g=>g.items.length);\n      searchEmpty", ".filter(g=>g.items.length&&(!this.isContributor()||({Contacts:this.canView('contact'),Deals:false,Tickets:this.canView('tickets'),Work:this.canView('work'),Notes:false,Reminders:this.canView('calendar'),Calls:false})[g.label]));\n      searchEmpty");
  change("if (calls.length) lines.push", "if (this.canView('meetings')&&this.canView('calendar')&&calls.length) lines.push");
  change("if (work.length) lines.push", "if (this.canView('work')&&work.length) lines.push");
  change("if (rems.length) lines.push", "if (this.canView('calendar')&&rems.length) lines.push");
  change("todayLine: lines.length?lines.join(' · '):'Nothing scheduled. A good day to get ahead.'", "todayLine: lines.length?lines.join(' · '):'Your assigned workspace is ready.'");
  change('onOp:e=>this.setOp(t.id,e.target.value), titleStyle:', "canUpdate:this.canEditSection('work'),readOnly:!this.canEditSection('work'),complete:()=>this.toggleTodo(t.id),onOp:e=>this.setOp(t.id,e.target.value), titleStyle:");
  change('canSkip:!!t.sop_instance_id', 'canSkip:!!t.sop_instance_id&&!this.isContributor()');
  change("bulkWork:sel.length>0,", "bulkWork:sel.length>0&&this.canEditSection('work'),");
  change("calAgendaEmpty:mode==='day'", "calCanReschedule:!this.isContributor(),calAgendaEmpty:mode==='day'");
  change("return{title:time+(first?", "return{draggable:this.isContributor()?'false':'true',title:time+(first?");
  source = source.replaceAll('draggable="true" sc-camel-on-drag-start="{{ i.drag }}" sc-camel-on-click="{{ i.go }}"', 'draggable="{{ i.draggable }}" sc-camel-on-drag-start="{{ i.drag }}" sc-camel-on-click="{{ i.go }}"');
  source = source.replaceAll('{{ calLabel }} · drag an item to an hour to reschedule', '{{ calLabel }}<sc-if value="{{ calCanReschedule }}"> · drag an item to an hour to reschedule</sc-if>');

  // Remove owner-only controls, rather than letting staff click into unsavable
  // workflows. Base flags remain visible inside the template's row scopes.
  const managementBindings = new Set(['openQuickAdd','openNewWork','newTicket','newMeeting','openNewMeeting','cd.startEdit','cd.addWork','cd.addTicket','cd.addMeeting','cd.addReminder','cd.addDeal','cd.generateAudit','cd.addDoc','cd.addNote','cd.addAccess','cd.remove','cd.openPrice','bulkWorkAssign','bulkWorkDue','bulkWorkTag','bulkWorkArchive','w.edit','w.remove','t.convert','t.remove','t.addNote','r.edit','r.remove','r.done','m.remove','actMarkAll','clearActivity','a.remove']);
  source = source.replace(/<button\b[^>]*sc-camel-on-click="\{\{\s*([\w.]+)\s*\}\}"[^>]*>[\s\S]*?<\/button>/g, (button,binding) => managementBindings.has(binding)?'<sc-if value="{{ canManageRecords }}">'+button+'</sc-if>':button);
  source = source.replace(/<button\b[^>]*sc-camel-on-click="\{\{\s*w\.(start|end)\s*\}\}"[^>]*>[\s\S]*?<\/button>/g, button => '<sc-if value="{{ canUpdateWork }}">'+button+'</sc-if>');
  source = source.replace(/<input\b[^>]*sc-camel-on-change="\{\{\s*w\.complete\s*\}\}"[^>]*>/g, checkbox => '<sc-if value="{{ canUpdateWork }}">'+checkbox+'</sc-if><sc-if value="{{ workReadOnly }}"><span aria-label="Read-only task status" style="width:17px;color:var(--ink-muted)">—</span></sc-if>');
  source = source.replace(/<input\b[^>]*sc-camel-on-change="\{\{\s*r\.toggle\s*\}\}"[^>]*>/g, checkbox => '<sc-if value="{{ canManageRecords }}">'+checkbox+'</sc-if>');
  source = source.replace(/<sc-raw-select\b[^>]*sc-camel-on-change="\{\{\s*w\.onOp\s*\}\}"[^>]*>[\s\S]*?<\/sc-raw-select>/g, select => '<sc-if value="{{ canUpdateWork }}">'+select+'</sc-if><sc-if value="{{ workReadOnly }}"><span style="{{ w.opStyle }}">{{ w.op }}</span></sc-if>');
  wrapContainer('{{ todayBoardTitle }}','section','canShowWork');
  wrapContainer('>Needs attention</h2>','section','canManageRecords');
  wrapContainer('>Calls today</h2>','section','canShowDailyMeetings');
  wrapContainer('list="{{ tRems }}"','section','canShowCalendar');
  wrapContainer('>Prep owed</h2>','section','canManageRecords');
  wrapContainer('>Work due today</h2>','section','canShowWork');
  // This top-right block carries only work counts and work scope controls.
  const todayStart=source.indexOf('<sc-if value="{{ vToday }}"');
  const rightStart=source.indexOf('<div style="text-align:right">',todayStart);
  if(rightStart<0)throw Error('Missing Today work scope block.');
  const rightMarker=source.slice(rightStart,rightStart+40);
  wrapContainer(rightMarker,'div','canShowWork');
  return source;
}

module.exports={fixNativeWorkflowTemplate};
if (require.main === module) {
  const target=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html'));
  const html=fs.readFileSync(target,'utf8');
  const match=html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
  if(!match)throw Error('CRM template not found.');
  const before=JSON.parse(match[1]),after=fixNativeWorkflowTemplate(before);
  fs.writeFileSync(target,html.replace(match[1],()=>JSON.stringify(after).replace(/<\/script/gi,'<\\/script')));
  console.log(after===before?'Native workflows already patched.':'Native workflow consistency patch applied.');
}
