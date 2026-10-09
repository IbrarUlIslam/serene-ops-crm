const fs=require('fs');
function isolateCommandCentre(template){
 if(template.includes('// Command centre assigned isolation v5.'))return template;
 const alreadyIsolated=template.includes('// Command centre assigned isolation v4.');
 const replace=(before,after)=>{if(!template.includes(before))throw Error('Missing isolation anchor: '+before.slice(0,110));template=template.replace(before,after);};
 if(!alreadyIsolated){
 replace('  // Command centre removed event exclusion v3.',`  // Command centre assigned isolation v4.
  meetingAssignedToMe(row){
    const explicit=[row.assignee,row.assignee_user_id,row.assigned_to,...(Array.isArray(row.assignees)?row.assignees:[]),...(Array.isArray(row.assigned_user_ids)?row.assigned_user_ids:[])].some(value=>String(typeof value==='object'?value?.user_id||value?.id:value||'').trim());
    return this.assignedToMe(explicit?row:{...row,assignee_user_id:row.host_user_id});
  }
  // Command centre removed event exclusion v3.`);
 replace('const calls = db.meetings.filter(m=>!m.archived_at&&!m.deleted_at).filter(m=>{','const calls = db.meetings.filter(m=>!m.archived_at&&!m.deleted_at&&(!this.isContributor()||this.meetingAssignedToMe(m))).filter(m=>{');
 replace("const all=(db.todos||[]).filter(t=>!t.archived_at&&!t.deleted_at);","const all=(db.todos||[]).filter(t=>!t.archived_at&&!t.deleted_at&&(!this.isContributor()||this.assignedToMe(t))); ");
 replace("assignee:(t.assignee||'Unassigned').split(' ')[0], note:","assignee:this.isContributor()?this.actor():(t.assignee||'Unassigned').split(' ')[0], note:");
 }
 replace("me(){const db=this.state.db;return (db?.users||[]).find(u=>u.id===this.state.meId)||{id:null,name:'Your workspace',role:''};}","me(){const db=this.state.db,auth=this.state.accessUser,norm=x=>String(x||'').trim().toLowerCase();if(auth&&!auth.isOwner)return (db?.users||[]).find(u=>u.id===auth.id||u.auth_user_id===auth.id||(norm(auth.email)&&norm(u.email)===norm(auth.email)))||{id:auth.id,auth_user_id:auth.id,name:auth.name||'Your workspace',email:auth.email||'',role:'Contributor'};return (db?.users||[]).find(u=>u.id===this.state.meId)||{id:null,name:'Your workspace',role:''};}");
 replace("ids=new Set([this.state.meId,me.auth_user_id,me.name,me.email,auth.id,auth.name,auth.email]","ids=new Set([me.id,me.auth_user_id,me.name,me.email,auth.id,auth.name,auth.email]");
 replace("user=>user.id===this.state.meId||user.id===access.id||user.auth_user_id===access.id||norm(access.email)&&norm(user.email)===norm(access.email)","user=>user.id===access.id||user.auth_user_id===access.id||norm(access.email)&&norm(user.email)===norm(access.email)");
 template=template.replace('// Command centre assigned isolation v4.','// Command centre assigned isolation v5.');
 return template;
}
function patchFile(path='index.html'){
 const raw=fs.readFileSync(path,'utf8'),pattern=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(pattern);if(!m)throw Error('CRM template missing');const template=isolateCommandCentre(JSON.parse(m[2]));fs.writeFileSync(path,raw.replace(pattern,()=>m[1]+JSON.stringify(template).replace(/<\//g,'<\\/')+m[3]));
}
module.exports={isolateCommandCentre,patchFile};
if(require.main===module){patchFile();console.log('Command centre assigned isolation applied.');}
