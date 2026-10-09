'use strict';
const fs=require('node:fs'),path=require('node:path');

function simplifyCommandCentre(source){
  if(source.includes('// Compact command centre v1.'))return source;
  const change=(a,b)=>{if(!source.includes(a))throw Error('Missing command centre anchor: '+a.slice(0,90));source=source.replace(a,b);};
  const start=source.indexOf('<sc-if value="{{ vToday }}"'),end=source.indexOf('<sc-if value="{{ vMeet }}">',start);
  if(start<0||end<0)throw Error('Command centre markup not found.');
  const markup=`<sc-if value="{{ vToday }}">
          <div class="command-date">{{ commandDayLabel }}</div>
          <sc-if value="{{ canShowWork }}"><section class="command-panel" aria-label="Team workload">
            <div class="command-section-heading"><h2>{{ commandTeamTitle }}</h2><div class="command-section-actions"><span>{{ commandTeamCount }}</span><sc-if value="{{ canManageRecords }}"><button type="button" sc-camel-on-click="{{ manageTeam }}">Manage users</button></sc-if><button type="button" sc-camel-on-click="{{ viewTeamWork }}">View work</button></div></div>
            <sc-if value="{{ commandRosterError }}"><div class="command-roster-notice" role="status">{{ commandRosterError }} <button type="button" sc-camel-on-click="{{ retryTeamRoster }}">Retry</button></div></sc-if>
            <div class="command-team"><sc-for list="{{ board }}" as="b"><button type="button" sc-camel-on-click="{{ b.go }}" class="command-person"><span class="command-person-name">{{ b.name }}</span><span class="command-person-counts"><span><strong>{{ b.total }}</strong>Open</span><span><strong>{{ b.today }}</strong>Due today</span><span><strong style="{{ b.lateStyle }}">{{ b.late }}</strong>Overdue</span></span></button></sc-for></div>
            <sc-if value="{{ commandUnassigned }}"><div class="command-unassigned">{{ commandUnassigned }}</div></sc-if>
          </section></sc-if>
          <sc-if value="{{ commandHasAttention }}"><section class="command-panel" aria-label="Priority decisions"><div class="command-section-heading"><h2>Needs attention</h2></div><sc-for list="{{ commandAttention }}" as="a"><button type="button" sc-camel-on-click="{{ a.go }}" class="command-attention"><span style="{{ a.sevStyle }}">{{ a.sev }}</span><span><strong>{{ a.title }}</strong><small>{{ a.meta }}</small></span><span class="command-row-end">Review</span></button></sc-for></section></sc-if>
          <section class="command-panel" aria-label="Today’s actions"><div class="command-section-heading"><h2>Today’s actions</h2><span class="command-count">{{ commandAgendaCount }}</span></div><sc-for list="{{ commandAgenda }}" as="a"><button type="button" sc-camel-on-click="{{ a.go }}" class="command-agenda-row"><span class="command-type">{{ a.type }}</span><span><strong>{{ a.title }}</strong><small>{{ a.meta }}</small></span><span class="command-row-end" style="{{ a.whenStyle }}">{{ a.when }}</span></button></sc-for><sc-if value="{{ commandAgendaEmpty }}"><p class="command-empty">Nothing due today.</p></sc-if><sc-if value="{{ commandAgendaMore }}"><button type="button" sc-camel-on-click="{{ showCommandAgenda }}" class="command-more">View all {{ commandAgendaTotal }} actions</button></sc-if></section>
        </sc-if>
`;
  source=source.slice(0,start)+markup+source.slice(end);
  // Keep the timezone and upcoming strips in detailed sections.
  const wrapDiv=(className,flag)=>{const marker='class="'+className+'"',at=source.indexOf(marker),open=source.lastIndexOf('<div',at);if(at<0||open<0)throw Error('Missing header strip.');const re=/<\/?div\b[^>]*>/g;re.lastIndex=open;let depth=0,m,close=-1;while((m=re.exec(source))){depth+=m[0].startsWith('</')?-1:1;if(!depth){close=re.lastIndex;break;}}if(close<0)throw Error('Unclosed header strip.');source=source.slice(0,open)+'<sc-if value="{{ '+flag+' }}">'+source.slice(open,close)+'</sc-if>'+source.slice(close);};
  wrapDiv('crm-clock-strip','commandShowClock');
  change('<sc-if value="{{ canShowCalendar }}"><div class="crm-upcoming-strip"','<sc-if value="{{ commandShowUpcoming }}"><div class="crm-upcoming-strip"');
  change("vToday:this.canView('today')&&s.view==='today' && (contributor||live.length>0)","vToday:this.canView('today')&&s.view==='today'");
  change("workspaceLabel:contributor?'Assigned workspace':'Administrator workspace',", "commandShowClock:s.view!=='today', commandShowUpcoming:s.view!=='today'&&this.canView('calendar'), workspaceLabel:contributor?'Assigned workspace':'Administrator workspace',");
  change('Everything on the agenda, in the order the day happens.', 'Your team and today’s priorities.');
  change("else if(e.data.type==='serene-audit-documents-updated'", "else if(e.data.type==='serene-users-updated'&&new URL(frame.src,location.origin).pathname==='/users.html')this.refreshTeamRoster();\n      else if(e.data.type==='serene-audit-documents-updated'");
  change("if(this.workspaceReady()&&accessUser.isOwner){this.zoomFetchPhoneMapping();", "if(this.workspaceReady()&&accessUser.isOwner){this.refreshTeamRoster();this.zoomFetchPhoneMapping();");
  change("this.zoomFetchCallsList();}this.checkDueNotifications();},60000);", "this.zoomFetchCallsList();if(this.state.view==='today')this.refreshTeamRoster();}this.checkDueNotifications();},60000);");
  change("this.setState(Object.assign({view,gq:'',err:''},extra||{}),()=>window.scrollTo({top:0,behavior:'instant'}));", "this.setState(Object.assign({view,gq:'',err:''},extra||{}),()=>{window.scrollTo({top:0,behavior:'instant'});if(view==='today')this.refreshTeamRoster();});");
  source=source.replaceAll('this.setState({db:null,accessUser:null,','this.setState({db:null,teamRoster:null,teamRosterError:\'\',accessUser:null,');
  change("const meName=this.actor(), mineOnly=this.state.scope==='mine';", "const meName=this.actor(), mineOnly=this.isContributor();");
  const todayStart=source.indexOf('  todayVals(X){'),todayEnd=source.indexOf('  clientsVals(X){',todayStart);
  let today=source.slice(todayStart,todayEnd);
  today=today.replace('    return {\n      greeting:', '    const day = {\n      greeting:');
  today=today.replace('      tWork:work, tWorkEmpty:!work.length\n    };', '      tWork:work, tWorkEmpty:!work.length\n    };\n    return Object.assign(day,this.compactCommandVals(X,day));');
  source=source.slice(0,todayStart)+today+source.slice(todayEnd);
  change('  todayVals(X){',`  // Compact command centre v1.
  async refreshTeamRoster(){
    if(!this.workspaceReady()||this.isContributor())return;
    const identity=this.state.accessUser.id||this.state.accessUser.email,request=(this._teamRosterRequest||0)+1;this._teamRosterRequest=request;
    const current=()=>request===this._teamRosterRequest&&this.workspaceReady()&&!this.isContributor()&&identity===(this.state.accessUser.id||this.state.accessUser.email);
    try{const response=await this.apiFetch('/api/users');if(!response.ok)throw Error('Team list could not refresh.');const value=await response.json();if(!Array.isArray(value.users))throw Error('Team list could not refresh.');if(!current())return;
      const norm=x=>String(x||'').trim().toLowerCase();const teamRoster=value.users.map(user=>{const old=(this.state.db.users||[]).find(item=>norm(item.email)===norm(user.email));return{id:old?.id||user.id,auth_user_id:user.id,name:user.name,email:user.email,status:user.status,isOwner:user.isOwner,role:user.isOwner?'Owner / Admin':'Contributor'};});
      this.setState({teamRoster,teamRosterError:''});
    }catch(error){if(current())this.setState({teamRosterError:'Showing the last available team list. Refresh failed.'});}
  }
  taskAssignedToUser(task,user){const norm=x=>String(x||'').trim().toLowerCase(),ids=new Set([user.id,user.auth_user_id,user.name,user.email].map(norm).filter(Boolean));return [task.assignee,task.assignee_user_id,task.assigned_to,...(Array.isArray(task.assignees)?task.assignees:[]),...(Array.isArray(task.assigned_user_ids)?task.assigned_user_ids:[])].some(value=>ids.has(norm(typeof value==='object'?value?.user_id||value?.id:value)));}
  commandRoster(db){return (this.isContributor()?db.users:(this.state.teamRoster||db.users)).filter(user=>user.status!=='disabled'&&!user.deleted_at);}
  compactCommandVals(X,day){
    const db=X.db,contributor=this.isContributor(),now=new Date(this.state.now),date=this.partsInTZ(now,this.PKT),key=date.year+'-'+date.month+'-'+date.day;
    const inDay=task=>task.due_at&&this.dateKeyInTZ(task.due_at,this.PKT)===key;
    const open=(db.todos||[]).filter(task=>task.status==='Open'&&!task.archived_at&&!task.deleted_at);
    const roster=this.commandRoster(db),board=roster.map(user=>{const tasks=open.filter(task=>this.taskAssignedToUser(task,user)),late=tasks.filter(task=>this.overdue(task.due_at)).length;return{name:user.name,first:user.name,total:String(tasks.length),today:String(tasks.filter(inDay).length),late:String(late),lateStyle:'color:'+(late?this.RED:this.MUTED),go:()=>this.go('work',{wScope:contributor?'mine':'all',wGroup:'owner',proj:'all',wAssignee:contributor?null:user})};});
    const unassigned=contributor?0:open.filter(task=>![task.assignee,task.assignee_user_id,task.assigned_to,...(task.assignees||[]),...(task.assigned_user_ids||[])].some(value=>String(typeof value==='object'?value?.user_id||value?.id:value||'').trim())).length;
    const attention=!contributor?this.attentionVals(X).attentionRows.filter(item=>item.sev!=='Info').slice(0,4):[];
    const blockedTitles=new Set(attention.map(item=>item.title)),agenda=[];
    if(this.canView('meetings')&&this.canView('calendar'))for(const row of day.tCalls)agenda.push({type:'Meeting',title:row.name,meta:row.kind,when:row.mine,whenStyle:'color:var(--muted)',go:row.go});
    if(this.canView('calendar'))for(const row of day.tRems)agenda.push({type:'Reminder',title:row.title,meta:[row.name,!contributor?row.assignee:''].filter(Boolean).join(' · '),when:row.when,whenStyle:row.whenStyle,go:row.go});
    if(!contributor)for(const row of day.tPrep)agenda.push({type:'Audit',title:row.name,meta:'Prepare meeting materials',when:row.due,whenStyle:row.dueStyle,go:row.go});
    if(this.canView('work'))for(const row of day.tWork)if(!blockedTitles.has(row.title))agenda.push({type:'Work',title:row.title,meta:[row.client,!contributor?row.assignee:''].filter(Boolean).join(' · '),when:row.due,whenStyle:row.dueStyle,go:()=>this.go('work',{wScope:contributor?'mine':'all',proj:'today',wAssignee:null})});
    const shown=this.state.commandAgendaExpanded?agenda:agenda.slice(0,8);
    return{board,commandDayLabel:this._dtf(this.PKT,{weekday:'long',month:'long',day:'numeric'}).format(now),commandTeamTitle:contributor?'Your workload':'Team',commandTeamCount:contributor?'':roster.length+' active users',commandRosterError:contributor?'':this.state.teamRosterError||'',retryTeamRoster:()=>this.refreshTeamRoster(),manageTeam:()=>this.go('users'),viewTeamWork:()=>this.go('work',{wScope:contributor?'mine':'all',proj:'all',wAssignee:null}),commandUnassigned:unassigned?unassigned+' unassigned task'+(unassigned===1?'':'s'):'',commandAttention:attention,commandHasAttention:attention.length>0,commandAgenda:shown,commandAgendaEmpty:!agenda.length,commandAgendaCount:agenda.length?agenda.length+' action'+(agenda.length===1?'':'s'):'',commandAgendaTotal:agenda.length,commandAgendaMore:shown.length<agenda.length,showCommandAgenda:()=>this.setState({commandAgendaExpanded:true})};
  }
  todayVals(X){`);
  // Clicking a team member opens a real person filter in Work.
  change("    const items=pool.sort((a,b)=>new Date(a.due_at||0)-new Date(b.due_at||0));", "    const person=!this.isContributor()&&s.wAssignee;if(person)pool=pool.filter(task=>this.taskAssignedToUser(task,person));\n    const items=pool.sort((a,b)=>new Date(a.due_at||0)-new Date(b.due_at||0));");
  change("(t.assignee||'')===u.name", "this.taskAssignedToUser(t,u)");
  change("return {activeTimers,hasActiveTimers:activeTimers.length>0,workGroups:groups,", "return {workPersonLabel:person?.name||'',clearWorkPerson:()=>this.setState({wAssignee:null}),activeTimers,hasActiveTimers:activeTimers.length>0,workGroups:groups,");
  change('<sc-if value="{{ vWork }}">','<sc-if value="{{ vWork }}"><sc-if value="{{ workPersonLabel }}"><div class="command-work-filter">Work for {{ workPersonLabel }} <button type="button" sc-camel-on-click="{{ clearWorkPerson }}">Show everyone</button></div></sc-if>');
  return source;
}
module.exports={simplifyCommandCentre};
if(require.main===module){const file=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html')),raw=fs.readFileSync(file,'utf8'),re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(re);if(!m)throw Error('Bundled template missing.');const before=JSON.parse(m[2]),after=simplifyCommandCentre(before);fs.writeFileSync(file,raw.replace(re,()=>m[1]+JSON.stringify(after).replace(/<\//g,'<\\/')+m[3]));console.log(after===before?'Compact command centre already applied.':'Command centre simplified with a live team roster.');}
