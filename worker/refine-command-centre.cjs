'use strict';
const fs=require('node:fs'),path=require('node:path');
function refineCommandCentre(source){
  if(source.includes('// Command centre roster drilldown v2.'))return source;
  const change=(before,after)=>{if(!source.includes(before))throw Error('Missing command refinement anchor: '+before.slice(0,100));source=source.replace(before,after);};
  change('// Compact command centre v1.','// Compact command centre v1.\n  // Command centre roster drilldown v2.');
  change("norm(item.email)===norm(user.email)","norm(user.email)&&norm(item.email)===norm(user.email)");
  change("role:user.isOwner?'Owner / Admin':'Contributor'","role:user.isOwner?'Owner / Admin':'Contributor',assignmentAliases:[old?.name,old?.auth_user_id].filter(Boolean)");
  change('[user.id,user.auth_user_id,user.name,user.email].map(norm)','[user.id,user.auth_user_id,user.name,user.email,...(user.assignmentAliases||[])].map(norm)');
  change("commandRoster(db){return (this.isContributor()?db.users:(this.state.teamRoster||db.users)).filter(user=>user.status!=='disabled'&&!user.deleted_at);}",`commandRoster(db){const norm=value=>String(value||'').trim().toLowerCase(),access=this.state.accessUser||{},rows=(this.isContributor()?(db.users||[]).filter(user=>user.id===this.state.meId||user.id===access.id||user.auth_user_id===access.id||norm(access.email)&&norm(user.email)===norm(access.email)):(this.state.teamRoster||db.users||[]));return rows.filter(user=>user.status!=='disabled'&&!user.deleted_at);}
  workRoster(db){if(this.isContributor())return this.commandRoster(db);const rows=(db.users||[]).slice(),norm=value=>String(value||'').trim().toLowerCase();for(const user of this.state.teamRoster||[]){const index=rows.findIndex(old=>old.id===user.id||norm(user.email)&&norm(old.email)===norm(user.email));if(index<0)rows.push(user);else rows[index]=user;}return rows;}`);
  change('...(task.assignees||[]),...(task.assigned_user_ids||[])','...(Array.isArray(task.assignees)?task.assignees:[]),...(Array.isArray(task.assigned_user_ids)?task.assigned_user_ids:[])');
  change("else if(s.wGroup==='owner') groups=(db.users||[]).map", "else if(s.wGroup==='owner') groups=(person?[person]:this.workRoster(db)).map");
  change("const all=(db.todos||[]).filter(t=>!t.archived_at);", "const all=(db.todos||[]).filter(t=>!t.archived_at&&!t.deleted_at);");
  change("t.status==='Open'&&(!contributor||this.assignedToMe(t))", "t.status==='Open'&&!t.archived_at&&!t.deleted_at&&(!contributor||this.assignedToMe(t))");
  const start=source.indexOf('  todayVals(X){'),end=source.indexOf('  clientsVals(X){',start);
  let today=source.slice(start,end);
  const replaceDay=(before,after)=>{if(!today.includes(before))throw Error('Missing day anchor.');today=today.replace(before,after);};
  replaceDay('const end=new Date(now); end.setHours(23,59,59,999);\n    const startOfDay=new Date(now); startOfDay.setHours(0,0,0,0);',"const parts=this.partsInTZ(now,this.PKT),key=parts.year+'-'+parts.month+'-'+parts.day;\n    const startOfDay=new Date(this.dateTimeToUtc(key,'00:00',this.PKT)),end=new Date(startOfDay.getTime()+86400000-1);");
  replaceDay("name:c.name||'Unknown'", "name:c.name||m.topic||m.title||'Scheduled meeting'");
  replaceDay("mine:at.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})", "mine:this._dtf(this.PKT,{hour:'numeric',minute:'2-digit'}).format(at)");
  replaceDay("go:()=>this.openContact(m.contact_id,'details')", "go:()=>this.openMeeting(m.id)");
  replaceDay("go:()=>this.openContact(r.contact_id,'reminders')", "go:()=>this.canView('contact')?this.openContact(r.contact_id,'reminders'):this.go('calendar')");
  replaceDay("t.status==='Open' && new Date(t.due_at)<=end", "t.status==='Open'&&!t.archived_at&&!t.deleted_at && new Date(t.due_at)<=end");
  // Keep only preparation due today or earlier.
  replaceDay("return { name:c.name||'', checks:","return { name:c.name||'', prepDue:due, checks:");
  replaceDay("const prep = prepAll.filter(p=>isMine(p.owner));", "const prep = prepAll.filter(p=>isMine(p.owner)&&new Date(p.prepDue)<=end);");
  source=source.slice(0,start)+today+source.slice(end);
  return source;
}
function finalizeCommandCentre(source){
  if(source.includes('// Command centre removed event exclusion v3.'))return source;
  const start=source.indexOf('  todayVals(X){'),end=source.indexOf('  clientsVals(X){',start);
  let day=source.slice(start,end);
  const change=(before,after)=>{if(!day.includes(before))throw Error('Missing event exclusion anchor.');day=day.replace(before,after);};
  change('db.meetings.filter(m=>{', 'db.meetings.filter(m=>!m.archived_at&&!m.deleted_at).filter(m=>{');
  change('.filter(r=>!r.done &&', '.filter(r=>!r.done&&!r.archived_at&&!r.deleted_at &&');
  day=day.replace('  todayVals(X){','  // Command centre removed event exclusion v3.\n  todayVals(X){');
  return source.slice(0,start)+day+source.slice(end);
}
module.exports={refineCommandCentre,finalizeCommandCentre};
if(require.main===module){const file=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html')),raw=fs.readFileSync(file,'utf8'),re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(re);if(!m)throw Error('Bundled template missing.');const before=JSON.parse(m[2]),after=finalizeCommandCentre(refineCommandCentre(before));fs.writeFileSync(file,raw.replace(re,()=>m[1]+JSON.stringify(after).replace(/<\//g,'<\\/')+m[3]));console.log(after===before?'Command refinement already applied.':'Command centre roster and drilldown refined.');}
