'use strict';
const fs=require('node:fs'),path=require('node:path');

// These are interface paths from the CRM's original bundle. Animal avatars
// are deliberately excluded; every restored SVG is a labelled control or a
// decorative companion to visible text.
const ICONS={
  activity:'M3 12h4l2.5-7 4 14L16 12h5',
  calls:'M6.5 3h-3v3c0 7.7 6.8 14.5 14.5 14.5h3v-3l-4.5-1.5-2.5 2.5a17 17 0 01-8.5-8.5L8 7.5z',
  automations:'M13 2L4.5 13H11l-1 9 8.5-11H12z',
  calendar:'M8 2v3M16 2v3M3.5 5h17v16h-17zM3.5 10h17M8.5 14h2M13.5 14h2M8.5 17.5h2M13.5 17.5h2',
  today:'M8 2v3M16 2v3M4 5h16v15H4zM4 10h16M12 13v3l2 1',
  dashboard:'M3 13h7V3H3zM14 21h7V11h-7zM3 21h7v-4H3zM14 8h7V3h-7z',
  pipeline:'M4 4h4v16H4zM10 4h4v11h-4zM16 4h4v6h-4z',
  contacts:'M12 11a4 4 0 100-8 4 4 0 000 8zM4 21c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5',
  clients:'M4 21V6l7-3v18M11 21V10l9 3v8M15 21v-4M4 21h17',
  tickets:'M3 8V5h6l11 11-4 4L5 9zM7 7h.01',
  work:'M9 11l2.5 2.5L20 5M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9',
  reports:'M4 20V11M10 20V4M16 20v-7M22 20H2',
  settings:'M6 3v18M18 3v18M2 8h8M14 15h8',
  sops:'M5 3h14v4H5zM5 10h14v11H5zM8 14h8M8 17h5',
  social:'M4 18V8l8-4 8 4v10l-8 3zM8 11h8M8 15h5',
  inbox:'M3 5h18v14H3zM3 5l9 7 9-7',
  meetings:'M3 6h13v12H3zM16 10l5-3v10l-5-3z',
  users:'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 21c0-3.5 3.5-5 7-5s7 1.5 7 5M17 11a3 3 0 100-6M22 21c0-3-2.5-4.5-5-4.5',
  audits:'M6 3h12v18H6zM9 7h6M9 11h6M9 15l2 2 4-4',
  search:'M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM16 16l5 5',
  plus:'M12 5v14M5 12h14',bell:'M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6M10 21h4',
  close:'M6 6l12 12M18 6L6 18',check:'M4 12l5 5L20 6',
  previous:'M15 5l-7 7 7 7',next:'M9 5l7 7-7 7',down:'M5 9l7 7 7-7',up:'M5 15l7-7 7 7',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  archive:'M4 7h16v3H4zM6 10v10h12V10M10 14h4',
  edit:'M4 20l4-1L20 7l-3-3L5 16zM14 7l3 3',
  download:'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
  upload:'M12 17V5M7 10l5-5 5 5M4 17v4h16v-4',
  copy:'M8 8h12v13H8zM4 16V3h12',
  refresh:'M20 7V3l-3 3M20 7a8 8 0 10.2 9M20 7h-4',
  play:'M7 4l13 8-13 8z',pause:'M7 4v16M17 4v16',
  stop:'M6 6h12v12H6z',clock:'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l4 2',
  folder:'M3 6h7l2 2h9v13H3z',shield:'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
  filter:'M4 5h16l-6 7v7l-4-2v-5z',heart:'M12 20s-7-4.5-7-9a4 4 0 017-2.5A4 4 0 0119 11c0 4.5-7 9-7 9z',
  database:'M12 7c4.4 0 8-1.3 8-2.5S16.4 2 12 2 4 3.3 4 4.5 7.6 7 12 7zM4 4.5v15C4 20.9 7.6 22 12 22s8-1.1 8-2.5v-15'
};
const STAGE_ICONS={
  'Demo scheduled':ICONS.calendar,'Audit sent':ICONS.audits,'Pre-meeting prep':ICONS.sops,'No show':ICONS.close,'Meeting held':ICONS.users,
  'Post-meeting audit sent':ICONS.inbox,'Initiate':ICONS.play,'Contract sent':ICONS.audits,'Closed won':ICONS.check,'Closed lost':ICONS.archive
};
function svg(pathValue,key='interface',small=false){return '<svg class="ui-icon'+(small?' ui-icon--small':'')+'" data-ui-icon="'+key+'" sc-camel-view-box="0 0 24 24" width="'+(small?16:18)+'" height="'+(small?16:18)+'" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="'+pathValue+'"></path></svg>';}

function restoreInterfaceBoards(input){
  if(input.includes('// Interface icons and ticket board v1.'))return input;
  let source=input;
  function change(before,after){if(!source.includes(before))throw Error('Missing interface restoration anchor: '+before.slice(0,100));source=source.replace(before,after);}
  function replaceView(flag,markup){const marker='<sc-if value="{{ '+flag+' }}">',start=source.indexOf(marker);if(start<0)throw Error('Missing '+flag+' section');const re=/<\/?sc-if\b[^>]*>/g;re.lastIndex=start;let n=0,m,end=-1;while((m=re.exec(source))){n+=m[0].startsWith('</')?-1:1;if(!n){end=re.lastIndex;break;}}if(end<0)throw Error('Unclosed '+flag+' section');source=source.slice(0,start)+markup+source.slice(end);}
  function replaceMethod(name,body){const at=source.indexOf('  '+name+'('),end=source.indexOf('\n  }\n',at);if(at<0||end<0)throw Error('Missing method '+name);source=source.slice(0,at)+body+source.slice(end+5);}
  change('  ICON = {};','  // Interface icons and ticket board v1.\n  ICON = '+JSON.stringify(ICONS,null,2)+';');
  change('  STAGE_ICON = {};','  STAGE_ICON = '+JSON.stringify(STAGE_ICONS,null,2)+';');

  replaceView('vTickets',`<sc-if value="{{ vTickets }}">
          <div class="ticket-toolbar">
            <input value="{{ tQ }}" sc-camel-on-change="{{ onTicketQ }}" placeholder="Search tickets" aria-label="Search tickets">
            <sc-raw-select value="{{ tType }}" sc-camel-on-change="{{ onTicketType }}" aria-label="Ticket type"><sc-for list="{{ tTypeOpts }}" as="o"><sc-raw-option value="{{ o }}">{{ o }}</sc-raw-option></sc-for></sc-raw-select>
            <span class="ticket-summary">{{ tixSummary }}</span><span class="toolbar-spacer"></span>
            <sc-if value="{{ ticketCanCreate }}"><button type="button" class="ui-action button-primary" sc-camel-on-click="{{ openNewTicket }}">New ticket</button></sc-if>
          </div>
          <sc-if value="{{ ticketReadOnly }}"><p class="ticket-readonly">You can review your assigned tickets. Status changes are read-only.</p></sc-if>
          <div class="ticket-board" aria-label="Tickets by status">
            <sc-for list="{{ tixCols }}" as="col"><section class="ticket-column" sc-camel-on-drag-over="{{ col.over }}" sc-camel-on-drop="{{ col.drop }}" aria-label="{{ col.ariaLabel }}" style="{{ col.columnStyle }}">
              <div class="ticket-column-heading"><div class="ticket-column-label">${svg('{{ col.icon }}','ticket-status',true)}<h2>{{ col.label }}</h2><span class="ticket-column-count">{{ col.count }}</span></div><sc-if value="{{ col.hasLate }}"><div class="ticket-column-late">{{ col.late }}</div></sc-if></div>
              <div class="ticket-column-cards"><sc-for list="{{ col.cards }}" as="k"><article class="{{ k.cardClass }}" draggable="{{ k.draggable }}" sc-camel-on-drag-start="{{ k.dragStart }}" sc-camel-on-drag-end="{{ k.dragEnd }}">
                <button type="button" class="ticket-card-open" sc-camel-on-click="{{ k.toggle }}" aria-expanded="{{ k.expanded }}"><span class="ticket-card-topline"><span style="{{ k.typeStyle }}">{{ k.type }}</span><span style="{{ k.ageStyle }}">{{ k.age }}</span></span><strong class="ticket-card-title">{{ k.title }}</strong><span class="ticket-card-client">{{ k.client }}</span><span class="ticket-card-meta">{{ k.module }}<sc-if value="{{ k.hasWork }}"> · {{ k.work }}</sc-if></span><span class="ticket-card-owner">{{ k.assignee }}</span></button>
              </article></sc-for><sc-if value="{{ col.empty }}"><p class="ticket-column-empty">No tickets</p></sc-if></div>
            </section></sc-for>
          </div>
          <sc-if value="{{ hasTicketDetail }}"><section class="ticket-detail" aria-label="{{ ticketDetail.title }}">
            <div class="ticket-detail-heading"><div><span class="ticket-detail-eyebrow">{{ ticketDetail.status }}</span><h2>{{ ticketDetail.title }}</h2><p>{{ ticketDetail.client }} · {{ ticketDetail.module }}</p></div><button type="button" class="ui-action" sc-camel-on-click="{{ closeTicketDetail }}">Close</button></div>
            <div class="ticket-detail-grid"><div class="ticket-detail-description"><h3>Description</h3><p>{{ ticketDetail.body }}</p><small>{{ ticketDetail.raised }}</small></div><div class="ticket-detail-status"><label>Status<sc-raw-select value="{{ ticketDetail.status }}" sc-camel-on-change="{{ ticketDetail.onStatus }}" disabled="{{ ticketDetail.readOnly }}" aria-label="Ticket status"><sc-for list="{{ ticketDetail.statusOpts }}" as="o"><sc-raw-option value="{{ o }}">{{ o }}</sc-raw-option></sc-for></sc-raw-select></label><p>{{ ticketDetail.assignee }}</p></div></div>
            <sc-if value="{{ ticketShowWork }}"><div class="ticket-detail-work"><h3>Linked work</h3><sc-for list="{{ ticketDetail.kids }}" as="w"><div class="ticket-linked-work"><button type="button" sc-camel-on-click="{{ w.go }}">{{ w.title }}</button><span style="{{ w.statusStyle }}">{{ w.status }}</span></div></sc-for><sc-if value="{{ ticketDetail.kidsEmpty }}"><p>No linked work.</p></sc-if></div></sc-if>
            <div class="ticket-detail-actions"><sc-if value="{{ ticketCanCreate }}"><button type="button" class="ui-action" sc-camel-on-click="{{ ticketDetail.toWork }}">Make work item</button></sc-if><sc-if value="{{ ticketDetail.openMail }}"><button type="button" class="ui-action" sc-camel-on-click="{{ ticketDetail.openMail }}">Open email</button></sc-if><sc-if value="{{ ticketDetail.openClient }}"><button type="button" class="ui-action" sc-camel-on-click="{{ ticketDetail.openClient }}">Client record</button></sc-if><sc-if value="{{ ticketCanCreate }}"><button type="button" class="ui-action button-quiet" sc-camel-on-click="{{ ticketDetail.remove }}">Archive</button></sc-if></div>
          </section></sc-if>
          <sc-if value="{{ ticketsViewEmpty }}"><p class="ticket-board-empty">{{ ticketEmptyMessage }}</p></sc-if>
        </sc-if>`);

  replaceMethod('ticketVals',`  ticketVals(X){
    const s=this.state,db=X.db,now=new Date(s.now),editable=this.canEditSection('tickets'),owner=!this.isContributor(),showWork=this.canView('work');
    let rows=(db.tickets||[]).filter(t=>!t.archived_at&&!t.deleted_at);
    if((s.tType||'All')!=='All')rows=rows.filter(t=>t.type===s.tType);
    if((s.tQ||'').trim()){const q=s.tQ.trim().toLowerCase();rows=rows.filter(t=>(String(t.title||'')+' '+((X.byId[t.contact_id]||{}).name||'')).toLowerCase().includes(q));}
    const cardOf=t=>{
      const c=X.byId[t.contact_id]||{},linked=showWork?(db.todos||[]).filter(w=>w.ticket_id===t.id&&!w.archived_at&&!w.deleted_at):[],tz=c.timezone,expanded=(s.tixExpand||s.tixOpen)===t.id;
      return{id:t.id,title:t.title||'Untitled ticket',type:t.type||'Request',status:t.status,expanded,readOnly:!editable,draggable:editable?'true':'false',cardClass:'ticket-card'+(t.type==='Problem'?' ticket-card--problem':'')+(expanded?' ticket-card--selected':''),
        dragStart:e=>{if(!this.canEditSection('tickets')){e?.preventDefault?.();return;}e?.dataTransfer?.setData('text/plain',t.id);},dragEnd:()=>{},
        toggle:()=>this.setState({tixExpand:expanded?null:t.id,tixOpen:null}),
        typeStyle:'color:'+(t.type==='Problem'?this.RED:this.MUTED),ageStyle:'color:'+this.MUTED,age:t.raised_at?this.ageOf(t.raised_at):'New',
        client:c.name||'Internal',module:this.svcOf(t.module).name,assignee:this.workRoster(db).filter(user=>this.taskAssignedToUser(t,user)).map(user=>user.name).join(', ')||t.assignee||'Unassigned',hasWork:linked.length>0,work:linked.length+' task'+(linked.length===1?'':'s'),
        body:(t.body||'').trim()||'No description recorded.',raised:'Raised '+(t.raised_at?this.ageOf(t.raised_at)+' ago':'recently')+(t.channel?' via '+t.channel:''),hasLocal:!!tz,localTime:tz?this._dtf(tz,{hour:'numeric',minute:'2-digit'}).format(now):'',
        statusOpts:this.TSTAT,onStatus:e=>this.setTicketStatus(t.id,e.target.value),
        kids:linked.map(w=>({title:w.title,status:w.status==='Done'?'Done':this.opOf(w),statusStyle:'color:'+(w.status==='Done'?this.GREEN:(this.opOf(w)==='Blocked'?this.RED:this.MUTED)),go:()=>owner?this.openEditTask(w,X):this.go('work',{wScope:'mine',proj:'all',wAssignee:null})})),kidsEmpty:!linked.length,
        toWork:()=>this.ticketToWork(t),openMail:owner&&t.zoho_message_id?()=>this.go('inbox',{mailSel:t.zoho_message_id}):null,openClient:this.canView('contact')&&c.id?()=>this.openContact(c.id,'tickets'):null,remove:()=>this.archiveOne('tickets',t.id,'ticket')};
    };
    const tones={'Inquiry':this.MUTED,'Assigned':this.INK,'In progress':this.CYAN||'#00707D','Waiting on client feedback':this.AMBER,'Query done':this.GREEN};
    const paths={'Inquiry':this.ICON.tickets,'Assigned':this.ICON.contacts,'In progress':this.ICON.work,'Waiting on client feedback':this.ICON.clock,'Query done':this.ICON.check};
    const cols=this.TSTAT.map(stat=>{const list=rows.filter(t=>t.status===stat),late=list.filter(t=>stat!=='Query done'&&t.raised_at&&now-new Date(t.raised_at)>3*86400000).length;return{key:stat,label:stat,count:list.length,ariaLabel:stat+': '+list.length+' tickets',icon:paths[stat],columnStyle:'--ticket-stage-color:'+tones[stat],hasLate:late>0,late:late+' overdue',empty:!list.length,cards:list.sort((a,b)=>new Date(b.raised_at||0)-new Date(a.raised_at||0)).map(cardOf),over:e=>{if(this.canEditSection('tickets'))e?.preventDefault?.();},drop:e=>{if(!this.canEditSection('tickets'))return;e?.preventDefault?.();const id=e?.dataTransfer?.getData('text/plain');if(rows.some(t=>t.id===id))this.setTicketStatus(id,stat);}};});
    const selected=rows.find(t=>t.id===(s.tixExpand||s.tixOpen));
    return{tQ:s.tQ||'',onTicketQ:e=>this.setState({tQ:e.target.value}),tType:s.tType||'All',onTicketType:e=>this.setState({tType:e.target.value}),tTypeOpts:['All','Request','Problem'],tixSummary:rows.length+' ticket'+(rows.length===1?'':'s'),ticketCanCreate:owner,ticketReadOnly:!editable,ticketShowWork:showWork,
      openNewTicket:()=>{if(!this.requireOwner())return;this.setState({modal:'newticket',err:'',draft:{contact:(X.clients[0]||{}).name||'',type:'Request',title:'',module:'01',channel:'Email'}});},
      tixCols:cols,ticketsViewEmpty:!rows.length,ticketEmptyMessage:s.tQ||(s.tType||'All')!=='All'?'No tickets match these filters.':'No tickets yet.',hasTicketDetail:!!selected,ticketDetail:selected?cardOf(selected):{},closeTicketDetail:()=>this.setState({tixExpand:null,tixOpen:null})};
  }
`);

  replaceView('vActivity',`<sc-if value="{{ vActivity }}">
          <div class="activity-toolbar"><input value="{{ aQ }}" sc-camel-on-change="{{ onAQ }}" placeholder="Filter activity" aria-label="Filter activity"><sc-raw-select value="{{ aWho }}" sc-camel-on-change="{{ onAWho }}" aria-label="Activity by"><sc-for list="{{ aWhoOpts }}" as="o"><sc-raw-option value="{{ o }}">{{ o }}</sc-raw-option></sc-for></sc-raw-select><span class="activity-count">{{ actCount }}</span><span class="toolbar-spacer"></span><sc-if value="{{ canManageRecords }}"><button type="button" class="ui-action" sc-camel-on-click="{{ actMarkAll }}">Mark all read</button><button type="button" class="ui-action button-quiet" sc-camel-on-click="{{ clearActivity }}">Clear log</button></sc-if></div>
          <div class="activity-list"><div class="activity-columns" aria-hidden="true"><span></span><span>Activity</span><span>By</span><span>Record</span><span>When</span><span></span></div><sc-for list="{{ actRows }}" as="a"><div class="activity-row">
            <span class="activity-icon">${svg('{{ a.icon }}','activity-entry')}</span>
            <span class="activity-summary"><span class="activity-unread" style="{{ a.dotStyle }}"></span><strong class="activity-description" style="{{ a.whatStyle }}">{{ a.what }}</strong><sc-if value="{{ a.hasSub }}"><span class="activity-subtext">{{ a.sub }}</span></sc-if></span>
            <span class="activity-person">{{ a.who }}</span><span class="activity-context"><sc-if value="{{ a.hasContact }}"><button type="button" sc-camel-on-click="{{ a.go }}">{{ a.name }}</button></sc-if><sc-if value="{{ a.noContact }}"><span>—</span></sc-if></span><span class="activity-time">{{ a.when }}</span>
            <span class="activity-action"><sc-if value="{{ canManageRecords }}"><button type="button" class="ui-icon-button" sc-camel-on-click="{{ a.remove }}" aria-label="Delete entry" title="Delete entry">${svg(ICONS.trash,'delete-entry',true)}<span class="sr-only">Delete entry</span></button></sc-if></span>
          </div></sc-for><sc-if value="{{ actEmpty }}"><p class="activity-empty">Nothing logged yet.</p></sc-if></div>
        </sc-if>`);
  change("return { what:a.what, who:a.who, icon:this.AVATAR[a.who]||this.ICON.contacts,", "return { what:a.what, who:a.who, icon:this.ICON[a.kind==='mail'?'inbox':a.kind==='meeting'?'meetings':a.kind==='call'?'calls':a.kind==='work'?'work':a.kind==='social'?'social':a.kind==='tickets'?'tickets':'activity'],");
  change("sub:a.sub||'', unread:a.read===false,", "sub:a.sub||'', hasSub:!!a.sub, unread:a.read===false,");
  change("whatStyle:'font-size:16px;text-wrap:pretty;color:var(--ink);font-weight:'", "whatStyle:'font-weight:'");
  change("name:c?c.name:'Not set', hasContact:!!c,", "name:this.canView('contact')&&c?c.name:'—', hasContact:this.canView('contact')&&!!c, noContact:!this.canView('contact')||!c,");
  change("if(tg.mailSel) return this.setState({view:'inbox', mailSel:tg.mailSel});", "if(tg.mailSel) return this.go('inbox',{mailSel:tg.mailSel});");
  change("if(tg.tixOpen) return this.setState({view:'tickets', tixOpen:tg.tixOpen});", "if(tg.tixOpen) return this.go('tickets',{tixExpand:tg.tixOpen,tixOpen:null});");

  // Restore the nav and status markers in their original positions. The logo
  // is a separate brand-mark element and is never touched by this helper.
  change('<span style="flex:1">{{ n.label }}</span>',svg('{{ n.icon }}','navigation',true)+'<span style="flex:1">{{ n.label }}</span>');
  change("chev:collapsed?'Show':'Hide'", "chev:collapsed?'Show':'Hide',chevIcon:collapsed?this.ICON.next:this.ICON.down");
  change('<span style="{{ g.chevStyle }}">{{ g.chev }}</span>',svg('{{ g.chevIcon }}','navigation-group',true)+'<span class="sr-only">{{ g.chev }}</span>');
  change('<div style="font:600 12px/1.3 \'Source Sans 3\',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--ink)">{{ col.name }}</div>',svg('{{ col.icon }}','pipeline-stage',true)+'<div style="font:600 12px/1.3 \'Source Sans 3\',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--ink)">{{ col.name }}</div>');

  const split=source.indexOf('<script type="text/x-dc"');let markup=source.slice(0,split),code=source.slice(split);
  const bindingIcons={toggleDialer:'calls',toggleBell:'bell',openQuickAdd:'plus',openNewTicket:'plus',openNewDeal:'plus',openNewWork:'plus',newMeeting:'plus',newSocialPost:'plus',calPrev:'previous',calNext:'next',calToday:'calendar',closeTicketDetail:'close',closeModal:'close','mt.close':'close','dw.close':'close',manageTeam:'users',manageUsers:'users',retryTeamRoster:'refresh',resolveSave:'refresh',reloadWorkspace:'refresh',viewTeamWork:'work',exportContacts:'download',exportJson:'download',openImport:'upload',saveModal:'check','mt.copy':'copy','d.openSummary':'check','ticketDetail.toWork':'work','ticketDetail.openMail':'inbox','ticketDetail.openClient':'clients','ticketDetail.remove':'archive',actMarkAll:'check',clearActivity:'trash',focusStart:'play',focusBreak:'pause',focusBack:'play',focusStop:'stop','w.start':'play','w.end':'stop','t.up':'up','t.down':'down'};
  markup=markup.replace(/<button\b([^>]*sc-camel-on-click="\{\{\s*([\w.]+)\s*\}\}"[^>]*)>([\s\S]*?)<\/button>/g,(whole,attributes,binding,body)=>{
    if(/<svg\b/.test(body))return whole;
    let icon=bindingIcons[binding];const text=body.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    if(!icon&&/^(?:New |Add |Schedule |Start workflow)/.test(text))icon='plus';
    if(!icon&&/^Archive$/.test(text))icon='archive';if(!icon&&/^(?:Delete|Clear log)/.test(text))icon='trash';if(!icon&&/^Edit$/.test(text))icon='edit';if(!icon&&/^Close$/.test(text))icon='close';
    if(!icon)return whole;
    attributes=attributes.replace(/class="([^"]*)"/,(_,value)=>'class="'+value+' ui-action"');if(!/\bclass=/.test(attributes))attributes+=' class="ui-action"';
    return '<button'+attributes+'>'+svg(ICONS[icon],icon,true)+body+'</button>';
  });
  const headingIcons={'Needs attention':'activity','Today’s actions':'today','Runs outside the weekly plan':'activity','Prep owed before a meeting':'audits','Due today and overdue':'clock','Waiting on a client':'clock','Calls booked':'calendar','This week, by client':'clients','Modules on the books':'folder','Scope and usage':'reports','Onboarding':'shield','Recent meetings':'meetings','Calls':'calls','Queues':'filter','Call log':'calls','Missed calls':'calls','Voicemail':'inbox','Content queue':'social','Active workflows':'sops','SOP template library':'sops','Workflow source registry':'database','Time &amp; Performance':'clock','Capacity':'dashboard','Pipeline conversion':'pipeline','Hours by module':'reports','Call outcomes':'calls','Client health':'heart','Business setup, still open':'work','Archive / Trash':'archive','Task types':'work','Modules and prices':'folder','People':'users','Your data':'database','Meeting summary':'meetings'};
  markup=markup.replace(/<(h[23])\b([^>]*)>([\s\S]*?)<\/\1>/g,(whole,tag,attributes,body)=>{const label=body.replace(/<[^>]*>/g,'').trim(),name=headingIcons[label];if(!name||body.includes('<svg'))return whole;attributes=attributes.replace(/class="([^"]*)"/,(_,value)=>'class="'+value+' ui-section-heading"');if(!/\bclass=/.test(attributes))attributes+=' class="ui-section-heading"';return '<'+tag+attributes+'>'+svg(ICONS[name],name)+body+'</'+tag+'>';});
  markup=markup.replace(/<input\b[^>]*placeholder="(?:Search[^"\n]*|Filter[^"\n]*|\{\{ searchPlaceholder \}\})"[^>]*>/g,input=>'<span class="ui-search-field">'+svg(ICONS.search,'search',true)+input+'</span>');
  return markup+code;
}

module.exports={restoreInterfaceBoards,ICONS,STAGE_ICONS};
if(require.main===module){const file=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html')),raw=fs.readFileSync(file,'utf8'),match=raw.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);if(!match)throw Error('Bundled template missing.');const before=JSON.parse(match[1]),after=restoreInterfaceBoards(before);fs.writeFileSync(file,raw.replace(match[1],()=>JSON.stringify(after).replace(/<\//g,'<\\/')));console.log(after===before?'Interface icon and board update already applied.':'Interface icons, ticket board and Activity alignment updated.');}
