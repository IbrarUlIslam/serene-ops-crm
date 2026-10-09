'use strict';
const fs=require('node:fs');
const path=require('node:path');
function enterpriseTemplate(input){
  if(input.includes('// Enterprise workspace safety v1.'))return input;
  let source=input;
  const change=(before,after)=>{if(!source.includes(before))throw Error('Missing enterprise anchor: '+before.slice(0,100));source=source.replace(before,after);};
  source=source.replace(/  @media \(prefers-color-scheme:dark\)\{\s*:root\{[\s\S]*?\n    \}\n  \}/,'');
  source=source.replace(/#f0eee9/gi,'#FDF6E3').replace(/#faf9f6/gi,'#FFFAF0');
  change('</helmet>','<link rel="stylesheet" href="/brand.css">\n</helmet>');
  change('<div style="display:flex;width:100%;min-height:100vh;background:#FDF6E3">','<div class="crm-shell" style="display:flex;width:100%;min-height:100vh;background:#FDF6E3">');
  change('<aside style="width:238px;','<aside class="crm-sidebar" style="width:238px;');
  change('<div style="padding:20px 24px 18px;','<div class="crm-brand" style="padding:20px 24px 18px;');
  change('<img src="bfa24971-a5e0-42fb-9b83-94c3fb9680d4" alt="" width="28" height="28" style="width:28px;height:28px;object-fit:contain;flex:0 0 auto">','<span class="brand-mark" role="img" aria-label="Serene Ops logo"></span>');
  change('<div style="padding:12px 14px;border-top:1px solid var(--rule);flex:0 0 auto;min-width:0;overflow:hidden">','<div class="crm-sidebar-footer" style="padding:12px 14px;border-top:1px solid var(--rule);flex:0 0 auto;min-width:0;overflow:hidden">');
  change('<header style="position:sticky;','<header class="crm-header" style="position:sticky;');
  change('<div style="display:flex;align-items:center;gap:16px;padding:14px 30px;flex-wrap:wrap">','<div class="crm-heading" style="display:flex;align-items:center;gap:16px;padding:14px 30px;flex-wrap:wrap">');
  change('<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto;position:relative">','<div class="crm-header-controls" style="display:flex;align-items:center;gap:10px;flex:0 0 auto;position:relative"><span class="crm-save-state" role="status" aria-live="polite">{{ saveLabel }}</span>');
  source=source.replace('font:600 8.5px/1 "Source Sans 3"','font:600 10px/1 "Source Sans 3"');
  change('<main id="main" style=','<main id="main" class="crm-content" style=');
  change('      <sc-if value="{{ isEmpty }}">',`      <sc-if value="{{ workspaceLoading }}"><div class="crm-system-notice loading" role="status"><div><strong>Opening your workspace</strong><p>Loading your records and assigned access.</p></div></div></sc-if>
      <sc-if value="{{ workspaceBlocked }}"><div class="crm-system-notice" role="alert"><div><strong>Workspace unavailable</strong><p>{{ workspaceError }}</p></div><button type="button" sc-camel-on-click="{{ reloadWorkspace }}">Reload workspace</button></div></sc-if>
      <sc-if value="{{ saveProblem }}"><div class="crm-system-notice" role="alert"><div><strong>{{ saveProblemTitle }}</strong><p>{{ saveProblemText }}</p></div><button type="button" sc-camel-on-click="{{ resolveSave }}">{{ resolveSaveLabel }}</button></div></sc-if>
      <sc-if value="{{ workspaceReady }}">
      <sc-if value="{{ isEmpty }}">`);
  change('</main>','</sc-if>\n</main>');
  change('  async componentDidMount(){',`  // Enterprise workspace safety v1.
  workspaceReady(){return !!(this.state.authChecked&&this.state.accessUser&&!this.state.meIdUnresolved&&!this.state.dbLoadFailed&&this.state.db);}
  canSaveWorkspace(){return this.workspaceReady()&&!this.state.saveConflict;}
  normalizeScopedWorkspace(db){for(const key of ['contacts','deals','tickets','todos','meetings','business','access','files','activity','notes','reminders','plans','calls','users','automations','autolog','sop_templates','sop_sources','sop_instances','scope_usage','social_posts','federal_kb','state_kb','task_types','emails','archive_contacts','archive_items'])if(!Array.isArray(db[key]))db[key]=[];db.user_prefs=db.user_prefs||{};db.checklists=db.checklists||{precall:[],onboarding:[]};db.org=db.org||{};return db;}
  reloadWorkspace(){if(this._saveEpoch>this._savedEpoch&&!confirm('Reload the latest workspace? Your unsaved changes in this window will be discarded.'))return;window.location.reload();}
  retrySave(){if(this.state.saveConflict)return this.reloadWorkspace();if(!this.workspaceReady())return;this.setState({saveError:'',saveStatus:'pending'},()=>this.flushDb());}
  async refreshAccess(){if(!this.state.authChecked)return;try{const r=await this.apiFetch('/api/me');if(!r.ok)return;const user=await r.json();if(JSON.stringify(user)!==JSON.stringify(this.state.accessUser)){clearTimeout(this._persistTimer);this.setState({db:null,accessUser:null,authChecked:false,modal:null,drawerId:null,gq:''});window.location.reload();}}catch(e){}}
  async componentDidMount(){`);
  change("    this.zoomFetchPhoneMapping();\n    this.zoomEnsureEmbed();\n    this.zoomFetchCallsList();\n    this.zohoFetchStatus();",'    this._saveEpoch=0;this._savedEpoch=0;');
  change("if (j && j.data && Array.isArray(j.data.contacts)) return j.data;", "if (j && j.data && Array.isArray(j.data.contacts)){this._snapshotEtag=res.headers.get('ETag')||JSON.stringify(j.updatedAt||'empty');return j.data;}");
  change("    db=this.ensureEnhancements(db);\n    (db.sop_instances||[]).filter(i=>i.status==='Active').forEach(i=>this.materializeSopTasks(db,i));\n    this.ensureRecurringOccurrences(db);\n    let meId=(db.users[0]||{id:'u1'}).id;", "    db=this.normalizeScopedWorkspace(db);\n    let meId=null;");
  change('    let meIdUnresolved=false;','    let meIdUnresolved=true;');
  change('        if (matchedUser) meId=matchedUser.id;', '        if(matchedUser){meId=matchedUser.id;meIdUnresolved=false;}');
  change("    const pref=(db.user_prefs||{})[meId]||{};", "    if(!dbLoadFailed&&accessUser?.isOwner&&!meIdUnresolved){db=this.ensureEnhancements(db);(db.sop_instances||[]).filter(i=>i.status==='Active').forEach(i=>this.materializeSopTasks(db,i));this.ensureRecurringOccurrences(db);}\n    const pref=(db.user_prefs||{})[meId]||{};");
  change("    this.autoTimer = setInterval(() => { this.runAutomations(); this.commitSilently(db2=>this.ensureRecurringOccurrences(db2)); this.checkDueNotifications(); this.zoomFetchCallsList(); }, 60000);\n    setTimeout(()=>{this.runAutomations();this.checkDueNotifications();},900);", `    if(this.workspaceReady()&&accessUser.isOwner){this.zoomFetchPhoneMapping();this.zoomEnsureEmbed();this.zoomFetchCallsList();this.zohoFetchStatus();}
    this.autoTimer=setInterval(()=>{if(!this.workspaceReady())return;if(!this.isContributor()){this.runAutomations();this.commitSilently(db2=>this.ensureRecurringOccurrences(db2));this.zoomFetchCallsList();}this.checkDueNotifications();},60000);
    this._accessTimer=setInterval(()=>this.refreshAccess(),15000);
    this._beforeUnload=e=>{if(this._saveEpoch>this._savedEpoch){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',this._beforeUnload);
    setTimeout(()=>{if(this.workspaceReady()){if(!this.isContributor())this.runAutomations();this.checkDueNotifications();}},900);`);
  change("componentWillUnmount(){ clearTimeout(this.timer); clearInterval(this.autoTimer); clearTimeout(this._t); window.removeEventListener('keydown', this._key); }", "componentWillUnmount(){clearTimeout(this.timer);clearInterval(this.autoTimer);clearInterval(this._accessTimer);clearTimeout(this._persistTimer);clearTimeout(this._t);window.removeEventListener('keydown',this._key);window.removeEventListener('message',this._auditMessage);window.removeEventListener('beforeunload',this._beforeUnload);}");
  change('  commit(fn, note){\n    const who=this.actor();', "  commit(fn, note){\n    if(!this.canSaveWorkspace()){this.toast('Reload your workspace before making changes.');return;}\n    this._saveEpoch=(this._saveEpoch||0)+1;\n    const who=this.actor();");
  const start=source.indexOf('  persistDb(){'),end=source.indexOf('\n  zoomMeetingPatch(',start);
  if(start<0||end<0)throw Error('Missing persistDb range');
  source=source.slice(0,start)+`  persistDb(){
    if(!this.canSaveWorkspace())return;clearTimeout(this._persistTimer);this.setState({saveStatus:'pending',saveError:''});this._persistTimer=setTimeout(()=>this.flushDb(),400);
  }
  async flushDb(){
    if(this._saveInFlight||!this.canSaveWorkspace()||this._saveEpoch===this._savedEpoch)return;
    const epoch=this._saveEpoch,body=JSON.stringify(this.state.db);this._saveInFlight=true;this.setState({saveStatus:'saving',saveError:''});
    try{const r=await this.apiFetch('/api/db',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json','If-Match':this._snapshotEtag||''},body});const value=await r.json();if(!r.ok){const e=Error(value.error||'Your changes could not be saved.');e.conflict=[409,428].includes(r.status);throw e;}
      this._snapshotEtag=r.headers.get('ETag')||JSON.stringify(value.data?.updatedAt||'empty');this._savedEpoch=epoch;
      const next={saveStatus:this._saveEpoch===epoch?'saved':'pending',saveError:'',saveConflict:false};if(value.snapshot&&this._saveEpoch===epoch)next.db=this.normalizeScopedWorkspace(value.snapshot);this.setState(next);
    }catch(e){this.setState({saveStatus:'error',saveError:e.message,saveConflict:!!e.conflict});}
    finally{this._saveInFlight=false;}
    if(!this.state.saveError&&this._saveEpoch>this._savedEpoch)this.flushDb();
  }
`+source.slice(end);
  change("  commitSilently(fn){if(!this.state.db)return;this.setState(s=>{const db=JSON.parse(JSON.stringify(s.db));fn(db);return{db};}, ()=>this.persistDb());}","  commitSilently(fn){if(!this.canSaveWorkspace())return;const previous=JSON.stringify(this.state.db),db=JSON.parse(previous);fn(db);if(JSON.stringify(db)===previous)return;this._saveEpoch=(this._saveEpoch||0)+1;this.setState({db},()=>this.persistDb());}");
  change("canView(view){if(!this.isContributor())return true;", "canView(view){if(!this.workspaceReady())return false;if(!this.isContributor())return true;");
  change("    this.setState(Object.assign({view, gq:'', err:''}, extra||{}));", "    this.setState(Object.assign({view,gq:'',err:''},extra||{}),()=>window.scrollTo({top:0,behavior:'instant'}));");
  change("      navGroups, zones, zonesBig, stats, me:this.me(),", `      workspaceReady:this.workspaceReady(),workspaceLoading:!s.authChecked,workspaceBlocked:s.authChecked&&!this.workspaceReady(),workspaceError:s.dbLoadFailed?'Your records could not be loaded. Editing is blocked to protect your saved data.':!s.accessUser?'Your sign-in could not be verified. Reload to sign in again.':'This account has not been added to the CRM. Ask Ibrar to invite you.',reloadWorkspace:()=>this.reloadWorkspace(),
      saveLabel:({saving:'Saving…',pending:'Unsaved changes',saved:'All changes saved',error:'Not saved'})[s.saveStatus]||'',saveProblem:!!s.saveError,saveProblemTitle:s.saveConflict?'Newer updates are available':'Changes have not been saved',saveProblemText:s.saveError,resolveSave:()=>this.retrySave(),resolveSaveLabel:s.saveConflict?'Reload latest':'Retry save',
      navGroups:this.workspaceReady()?navGroups:[], zones, zonesBig, stats, me:this.me(),`);
  change("const generated=(value.data?.files||[]).filter(f=>f.audit_report_id);", "if(this._saveEpoch===this._savedEpoch&&!this._saveInFlight){this._snapshotEtag=response.headers.get('ETag')||JSON.stringify(value.updatedAt||'empty');this.setState({db:this.normalizeScopedWorkspace(value.data)});return;}const generated=(value.data?.files||[]).filter(f=>f.audit_report_id);");
  source=source.replace('Closed-app delivery will be connected in the Cloudflare phase.','Browser reminders appear while the CRM is open.');
  return source;
}
if(require.main===module){const file=path.join(__dirname,'..','index.html');let raw=fs.readFileSync(file,'utf8');const re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;const m=raw.match(re),template=enterpriseTemplate(JSON.parse(m[2]));raw=raw.replace(re,()=>m[1]+JSON.stringify(template).replace(/<\//g,'<\\/')+m[3]);fs.writeFileSync(file,raw);const manifest=JSON.parse(raw.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/)[1]);for(const [id,name]of[['a749dbc7-efa0-4a0c-aece-2670d46cf08d','source-sans-3-latin.woff2'],['7e920336-7e2c-48a1-9c90-8b48ffc6488e','source-serif-4-latin.woff2']])fs.writeFileSync(path.join(__dirname,'..','assets',name),Buffer.from(manifest[id].data,'base64'));console.log('Enterprise workspace and save safety applied.');}
module.exports={enterpriseTemplate};
