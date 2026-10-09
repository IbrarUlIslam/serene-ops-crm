'use strict';
const fs=require('node:fs'),path=require('node:path');

function refineAssignedViews(input){
  if(input.includes('// Assigned view isolation v1.'))return input;
  let source=input;
  function change(before,after){if(!source.includes(before))throw Error('Missing assigned-view anchor: '+before.slice(0,90));source=source.replace(before,after);}
  function guard(method,rule){const re=new RegExp('(^  (?:async )?'+method+'\\([^\\n]*?\\)\\{)','m');if(!re.test(source))throw Error('Missing assigned method '+method);source=source.replace(re,'$1'+rule);}
  function wrapClosest(marker,tag,condition,parentDepth=0){
    const scriptAt=source.indexOf('<script type="text/x-dc"');const positions=[...source.slice(0,scriptAt).matchAll(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))].map(m=>m.index),ranges=new Map();
    if(!positions.length)throw Error('Missing assigned markup marker: '+marker);
    for(const at of positions){const ancestors=[],scan=new RegExp('<\\/?'+tag+'\\b[^>]*>','g');let token;while((token=scan.exec(source))&&token.index<=at){if(token[0].startsWith('</'))ancestors.pop();else ancestors.push(token.index);}const start=ancestors.at(-1-parentDepth);if(start===undefined)throw Error('Missing assigned container: '+marker);const re=new RegExp('<\\/?'+tag+'\\b[^>]*>','g');re.lastIndex=start;let depth=0,m,end=-1;while((m=re.exec(source))){depth+=m[0].startsWith('</')?-1:1;if(!depth){end=re.lastIndex;break;}}if(end<0)throw Error('Unclosed assigned container: '+marker);ranges.set(start,end);}
    for(const [start,end]of [...ranges].sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+'<sc-if value="{{ '+condition+' }}">'+source.slice(start,end)+'</sc-if>'+source.slice(end);
  }
  change('  contactTabVisible(tab){', '  // Assigned view isolation v1.\n  contactTabVisible(tab){');
  change('  contactTabVisible(tab){', `  assignedToMe(row){if(!row)return false;const norm=v=>String(v||'').trim().toLowerCase(),me=this.me(),auth=this.state.accessUser||{},ids=new Set([this.state.meId,me.auth_user_id,me.name,me.email,auth.id,auth.name,auth.email].map(norm).filter(Boolean));return [row.assignee,row.assignee_user_id,row.assigned_to,...(row.assignees||[]),...(row.assigned_user_ids||[])].some(value=>ids.has(norm(typeof value==='object'?value.user_id||value.id:value)));}
  contactTabVisible(tab){`);
  change("if((s.wScope||'all')==='mine')pool=pool.filter(t=>!t.assignee||t.assignee===this.actor());", "if((s.wScope||'all')==='mine')pool=pool.filter(t=>this.isContributor()?this.assignedToMe(t):!t.assignee||t.assignee===this.actor());");
  change("items.filter(t=>(t.assignee||'')===u.name)", "items.filter(t=>this.isContributor()?this.assignedToMe(t):(t.assignee||'')===u.name)");
  change("filter(p=>!contributor||!p.assignee||p.assignee===this.actor());", "filter(p=>!contributor||this.assignedToMe(p));");
  change("filter(t=>t.status==='Open'&&(!contributor||t.assignee===this.actor()))", "filter(t=>t.status==='Open'&&(!contributor||this.assignedToMe(t)))");
  change("const isMine=(who)=>!mineOnly || !who || who===meName;", "const isMine=(who,row)=>this.isContributor()?this.assignedToMe(row):!mineOnly || !who || who===meName;");
  source=source.replaceAll('isMine(r.assignee)','isMine(r.assignee,r)').replaceAll('isMine(t.assignee)','isMine(t.assignee,t)');
  change("canShowWork:this.canView('work'),", "canShowWork:this.canView('work'), canShowMeetings:this.canView('meetings'), canShowTickets:this.canView('tickets'), canShowActivity:this.canView('activity'), canShowDelivery:this.canView('work')||this.canView('tickets'),");
  change("calKeys:[['meeting','Meetings'],['task','Tasks'],['call','Calls'],['reminder','Reminders']].map", "calKeys:[['meeting','Meetings'],['task','Tasks'],['call','Calls'],['reminder','Reminders']].filter(([kind])=>kind==='meeting'?this.canView('meetings'):kind==='task'?this.canView('work'):this.canView('calendar')).map");
  change("groupOpts:[['client','By client'],['owner','By person'],['module','By module'],['day','By day']].map", "groupOpts:[['client','By client'],['owner','By person'],['module','By module'],['day','By day']].filter(([kind])=>kind!=='client'||this.canView('contact')).map");

  // Staff never receive a calculated price reconstructed from public module
  // prices as though it were the client's actual private commercial record.
  change('value:this.valueLabel(c),\n        valueStyle:', "value:this.isContributor()?'':this.valueLabel(c),\n        valueStyle:");
  change("clientsSummary: cards.length+' client'+(cards.length===1?'':'s')+' · '+this.money(X.clients.reduce((a,c)=>a+this.valueOf(c),0))+' recurring'", "clientsSummary: cards.length+' client'+(cards.length===1?'':'s')+(this.isContributor()?' assigned to you':' · '+this.money(X.clients.reduce((a,c)=>a+this.valueOf(c),0))+' recurring')");
  change("go:()=>this.openContact(c.id,'work'),\n        report:", "go:()=>this.openContact(c.id,this.canView('work')?'work':'details'),\n        report:");
  change("glance:glance.filter(g=>!this.isContributor()||!['Monthly','Notice'].includes(g.k)).map", "glance:glance.filter(g=>!this.isContributor()||(!['Monthly','Notice','Deal stage'].includes(g.k)&&(!['Open work','Hours logged'].includes(g.k)||this.canView('work'))&&(g.k!=='Open tickets'||this.canView('tickets'))&&(g.k!=='Reminders'||this.canView('calendar'))&&(g.k!=='Last touch'||this.canView('activity')))).map");
  change("contactCols:['Contact','Brokerage','Status','Modules','Monthly','Their time'],", "contactCols:['Contact','Brokerage','Status','Modules',...(this.isContributor()?[]:['Monthly']),'Their time'],");
  change("value: c.status==='Client'?this.valueLabel(c):'—',", "value: !this.isContributor()&&c.status==='Client'?this.valueLabel(c):'',");
  change("fromMail: !!t.zoho_message_id,", "fromMail: !this.isContributor()&&!!t.zoho_message_id,");
  change("openMail: t.zoho_message_id ?", "openMail: !this.isContributor()&&t.zoho_message_id ?");
  change("openClient: c.id ?", "openClient: this.canView('contact')&&c.id ?");
  change("who:c?c.name:'Unmatched meeting',\n        hasContact:!!c,", "who:c?(this.canView('contact')?c.name:'Assigned record'):'Assigned meeting',\n        hasContact:this.canView('contact')&&!!c,");
  change("openC: c?", "openC: this.canView('contact')&&c?");
  change("openD: deal?", "openD: !this.isContributor()&&deal?");
  change("hasDeal:!!deal,", "hasDeal:!this.isContributor()&&!!deal,");
  change("matchTxt:matchBadge?matchBadge.txt:'',", "matchTxt:this.canView('contact')&&matchBadge?matchBadge.txt:'',");
  change("const set=(k,v)=>this.patch('contacts', c.id, k, v, 'Contact updated from drawer: '+k);", "const set=(k,v)=>{if(!this.requireOwner())return;this.patch('contacts', c.id, k, v, 'Contact updated from drawer: '+k);};");
  change("].map(g=>Object.assign(g,{style:'font-size:12px;font-weight:600;color:#4C484F'})),\n      notes:this.noteCards", "].filter(g=>!this.isContributor()||(g.k!=='Monthly'&&(g.k!=='Open work'||this.canView('work'))&&(g.k!=='Open tickets'||this.canView('tickets'))&&(g.k!=='Reminders'||this.canView('calendar')))).map(g=>Object.assign(g,{style:'font-size:12px;font-weight:600;color:#4C484F'})),\n      notes:this.noteCards");
  for(const method of ['saveInternalNotes','saveManualSummary','linkMeetingContact','summaryToNotes','taskFromMeeting'])guard(method,'if(!this.requireOwner())return;');
  change("dialerOpen:!!s.dialerOpen,", "dialerOpen:!this.isContributor()&&!!s.dialerOpen,");
  change("toggleDialer:()=>this.setState({dialerOpen:!s.dialerOpen, dialerStage:'dial'}),", "toggleDialer:()=>{if(!this.requireOwner())return;this.setState({dialerOpen:!s.dialerOpen,dialerStage:'dial'});},");
  change("bellOpen:!!s.bellOpen,", "bellOpen:this.canView('activity')&&!!s.bellOpen,");
  change("bellBadgeStyle:'position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--critical);color:#fff;font-size:11px;font-weight:700;display:'", "bellBadgeStyle:'min-width:12px;padding:0;color:var(--ink-muted);font-size:12px;font-weight:600;display:'");

  // Publication is a factual status update after Ibrar's approval. Staff
  // cannot grant approval or publish a waiting draft through this control.
  guard('publishSocial', "const current=(this.state.db?.social_posts||[]).find(p=>p.id===id);if(this.isContributor()&&!['Approved','Ready'].includes(current?.status))return this.toast('Ibrar must approve this post before you can mark it published.');");
  change("published:p.status==='Published',action:p.status==='Published'?'Published':'Mark published',", "published:p.status==='Published',publishDisabled:p.status==='Published'||!this.canEditSection('social')||(this.isContributor()&&!['Approved','Ready'].includes(p.status)),action:p.status==='Published'?'Published':!this.canEditSection('social')?'Read-only':this.isContributor()&&!['Approved','Ready'].includes(p.status)?'Awaiting approval':'Mark published',");
  source=source.replaceAll('disabled="{{ p.published }}"','disabled="{{ p.publishDisabled }}"');

  // The server owns approval. Do not offer a completion action that it will
  // reject when a legacy approval task happens to be assigned to staff.
  change('  completionEvidenceReady(id,note){', `  staffApprovalTask(t){if(!this.isContributor()||!t)return false;if(t.social_post_id&&/^Approve /i.test(t.title||''))return true;const db=this.state.db,inst=(db.sop_instances||[]).find(i=>i.id===t.sop_instance_id),tpl=inst?.template_snapshot||(db.sop_templates||[]).find(i=>i.id===inst?.template_id);return (tpl?.steps||[]).some(step=>step.id===t.sop_step_id&&step.approval);}
  requireTaskUpdate(id){const task=(this.state.db?.todos||[]).find(t=>t.id===id);if(this.staffApprovalTask(task)){this.toast('Only Ibrar can approve this step.');return false;}return this.requireSectionEdit('work');}
  completionEvidenceReady(id,note){`);
  change("startTaskTimer(id){if(!this.requireSectionEdit('work'))return;", "startTaskTimer(id){if(!this.requireTaskUpdate(id))return;");
  change("if(!this.requireSectionEdit('work')||(complete&&!this.completionEvidenceReady(id,note)))return;", "if(!this.requireTaskUpdate(id)||(complete&&!this.completionEvidenceReady(id,note)))return;");
  change("setOp(id, op){if(!this.requireSectionEdit('work'))return;", "setOp(id, op){if(!this.requireTaskUpdate(id))return;");
  change("toggleTodo(id){if(!this.requireSectionEdit('work'))return;", "toggleTodo(id){if(!this.requireTaskUpdate(id))return;");
  change("canUpdate:this.canEditSection('work'),readOnly:!this.canEditSection('work'),", "canUpdate:this.canEditSection('work')&&!this.staffApprovalTask(t),readOnly:!this.canEditSection('work')||this.staffApprovalTask(t),");
  change("meta:t.source+' · '+(t.ticket_id?'from a ticket':'planned')", "meta:t.source+' · '+(t.ticket_id&&this.canView('tickets')?'from a ticket':'planned')");
  change("['today','My work',null]", "['today',this.canView('work')?'My work':'My day',null]");
  change("['My workspace',[['today','My work',null]", "['My workspace',[['today',this.canView('work')?'My work':'My day',null]");
  change("(this.isContributor()?'My work':'Command centre')", "(this.isContributor()?(this.canView('work')?'My work':'My day'):'Command centre')");

  wrapClosest('class="crm-upcoming-strip"','div','canShowCalendar');
  wrapClosest('{{ c.valueStyle }}','div','canShowClientSide',1);
  wrapClosest('{{ c.valueStyle }}','div','canManageRecords');
  source=source.replace('<div style="font:600 11px/1 \'Source Sans 3\',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-muted)">Monthly</div>', '<sc-if value="{{ canManageRecords }}"><div style="font:600 11px/1 \'Source Sans 3\',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-muted)">Monthly</div></sc-if>');
  wrapClosest('{{ c.stateStyle }}','span','canShowDelivery');
  wrapClosest('{{ c.nextCall }}','div','canShowMeetings');
  wrapClosest('{{ c.weekLabel }}','div','canShowWork');
  wrapClosest('{{ c.signals }}','div','canShowWork');
  wrapClosest('{{ cd.meetings }}','div','canShowMeetings');
  wrapClosest('{{ mt.saveManual }}','div','canManageRecords');
  wrapClosest('{{ mt.saveInternal }}','div','canManageRecords');
  wrapClosest('{{ mt.linkVal }}','div','canManageRecords');
  source=source.replaceAll('<sc-if value="{{ cd.isClient }}">','<sc-if value="{{ cd.isClient }}"><sc-if value="{{ canManageRecords }}">');
  // Match closing tags of the two client-only commercial/onboarding blocks.
  // Keeping the existing conditions nested avoids removing their contents.
  let at=0;while((at=source.indexOf('<sc-if value="{{ cd.isClient }}"><sc-if value="{{ canManageRecords }}">',at))>=0){const re=/<\/?sc-if\b[^>]*>/g;re.lastIndex=at;let depth=0,m,end=-1;while((m=re.exec(source))){depth+=m[0].startsWith('</')?-1:1;if(depth===1&&m[0].startsWith('</')){end=re.lastIndex;break;}}if(end<0)throw Error('Missing commercial block end.');source=source.slice(0,end)+'</sc-if>'+source.slice(end);at=end+8;}
  const ownerButtons=new Set(['toggleDialer','c.report','k.toWork','k.remove','mt.toNotes','mt.makeTask','mt.archive','dw.addNote','dw.addReminder']);
  source=source.replace(/<button\b[^>]*sc-camel-on-click="\{\{\s*([\w.]+)\s*\}\}"[^>]*>[\s\S]*?<\/button>/g,(button,binding)=>ownerButtons.has(binding)?'<sc-if value="{{ canManageRecords }}">'+button+'</sc-if>':binding==='toggleBell'?'<sc-if value="{{ canShowActivity }}">'+button+'</sc-if>':button);
  source=source.replace(/<input\b[^>]*sc-camel-on-change="\{\{ dw\.(?:onPhone|onEmail) \}\}"[^>]*>/g,input=>'<sc-if value="{{ canManageRecords }}">'+input+'</sc-if><sc-if value="{{ staffReadOnly }}"><span style="font-size:14px;color:var(--ink)">'+(input.includes('onPhone')?'{{ dw.phone }}':'{{ dw.email }}')+'</span></sc-if>');
  source=source.replace(/<sc-raw-select\b[^>]*sc-camel-on-change="\{\{ dw\.onOwner \}\}"[^>]*>[\s\S]*?<\/sc-raw-select>/g,select=>'<sc-if value="{{ canManageRecords }}">'+select+'</sc-if><sc-if value="{{ staffReadOnly }}"><span>{{ dw.owner }}</span></sc-if>');
  change("canManageRecords:!contributor,", "canManageRecords:!contributor, staffReadOnly:contributor,");
  change('placeholder="Search everything" aria-label="Search everything"','placeholder="{{ searchPlaceholder }}" aria-label="{{ searchPlaceholder }}"');
  change('gq:s.gq, onSearch:', "searchPlaceholder:contributor?'Search your workspace':'Search everything',dailyMeetingsTitle:contributor?'Meetings today':'Calls today',gq:s.gq, onSearch:");
  source=source.replace('>Calls today</h2>','>{{ dailyMeetingsTitle }}</h2>');
  source=source.replace(/<a\b[^>]*sc-camel-on-click="\{\{ (?:cd|dw|m)\.call \}\}"[^>]*>[\s\S]*?<\/a>/g,link=>'<sc-if value="{{ canManageRecords }}">'+link+'</sc-if>');
  change('canManageRecords:!contributor, staffReadOnly:contributor,', "canManageRecords:!contributor, staffReadOnly:contributor, canShowClientSide:!contributor||this.canView('meetings'), clientTimeColumns:!contributor||this.canView('meetings')?'1fr 1fr':'1fr', contactGridColumns:contributor?'28px minmax(140px,1.5fr) minmax(84px,1fr) 70px minmax(88px,1.1fr) 104px':'28px minmax(140px,1.5fr) minmax(84px,1fr) 70px minmax(88px,1.1fr) 70px 104px',");
  change('grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid var(--rule-soft)', 'grid-template-columns:{{ clientTimeColumns }};gap:0;border-bottom:1px solid var(--rule-soft)');
  source=source.replaceAll('grid-template-columns:28px minmax(140px,1.5fr) minmax(84px,1fr) 70px minmax(88px,1.1fr) 70px 104px;', 'grid-template-columns:{{ contactGridColumns }};');
  source=source.replace('<span style="font-size:15px;color:var(--ink);font-variant-numeric:tabular-nums">{{ c.value }}</span>', '<sc-if value="{{ canManageRecords }}"><span style="font-size:15px;color:var(--ink);font-variant-numeric:tabular-nums">{{ c.value }}</span></sc-if>');
  source=source.replaceAll('<sc-if value="{{ canUpdateWork }}"><input type="checkbox" checked="{{ w.done }}"','<sc-if value="{{ w.canUpdate }}"><input type="checkbox" checked="{{ w.done }}"').replaceAll('<sc-if value="{{ workReadOnly }}"><span aria-label="Read-only task status"','<sc-if value="{{ w.readOnly }}"><span aria-label="Read-only task status"');
  source=source.replaceAll('<sc-if value="{{ canUpdateWork }}"><sc-raw-select value="{{ w.op }}"','<sc-if value="{{ w.canUpdate }}"><sc-raw-select value="{{ w.op }}"').replaceAll('<sc-if value="{{ workReadOnly }}"><span style="{{ w.opStyle }}"','<sc-if value="{{ w.readOnly }}"><span style="{{ w.opStyle }}"');
  source=source.replaceAll('<sc-if value="{{ canUpdateWork }}"><button type="button" sc-camel-on-click="{{ w.start }}"','<sc-if value="{{ w.canUpdate }}"><button type="button" sc-camel-on-click="{{ w.start }}"').replaceAll('<sc-if value="{{ canUpdateWork }}"><button type="button" sc-camel-on-click="{{ w.end }}"','<sc-if value="{{ w.canUpdate }}"><button type="button" sc-camel-on-click="{{ w.end }}"');
  change("canShowWork:this.canView('work'),", "canShowContacts:this.canView('contact'), canShowWork:this.canView('work'),");
  source=source.replace(/<button\b[^>]*sc-camel-on-click="\{\{ w\.openDrawer \}\}"[^>]*>[\s\S]*?<\/button>/g,button=>'<sc-if value="{{ canShowContacts }}">'+button+'</sc-if><sc-if value="{{ noContactNavigation }}"><span style="font-size:14px;color:var(--ink-muted)">{{ w.client }}</span></sc-if>');
  change("canShowContacts:this.canView('contact'),", "canShowContacts:this.canView('contact'), noContactNavigation:!this.canView('contact'),");
  change('You can write the notes yourself below. They will be labelled as manual, not as a Zoom summary.', '{{ mt.failedHint }}');
  change("isFailed:st==='failed', isNone:", "failedHint:this.isContributor()?'Ibrar can add manual meeting notes.':'You can write the notes yourself below. They will be labelled as manual meeting notes.', isFailed:st==='failed', isNone:");
  return source;
}

module.exports={refineAssignedViews};
if(require.main===module){const file=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html')),html=fs.readFileSync(file,'utf8'),match=html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);if(!match)throw Error('Native template missing.');const before=JSON.parse(match[1]),after=refineAssignedViews(before);fs.writeFileSync(file,html.replace(match[1],()=>JSON.stringify(after).replace(/<\//g,'<\\/')));console.log(after===before?'Assigned views already refined.':'Assigned view traces and read-only controls refined.');}
