'use strict';
const fs=require('node:fs');
const file=require('node:path').join(__dirname,'..','index.html');
let raw=fs.readFileSync(file,'utf8');
const re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(re);
let t=JSON.parse(m[2]);
t=t.replace('<div style="display:flex;align-items:flex-end;gap:26px;row-gap:12px;padding:8px 30px 12px;flex-wrap:wrap">','<div class="crm-clock-strip" style="display:flex;align-items:flex-end;gap:26px;row-gap:12px;padding:8px 30px 12px;flex-wrap:wrap">').replace('<div style="display:flex;align-items:center;gap:14px;padding:8px 30px;border-top:1px solid var(--rule-soft);background:var(--chalk);flex-wrap:wrap">','<div class="crm-upcoming-strip" style="display:flex;align-items:center;gap:14px;padding:8px 30px;border-top:1px solid var(--rule-soft);background:var(--chalk);flex-wrap:wrap">');
t=t.replace(/  me\(\)\{[\s\S]*?\n  actor\(\)/, `  me(){const db=this.state.db;return (db?.users||[]).find(u=>u.id===this.state.meId)||{id:null,name:'Your workspace',role:''};}
  actor()`);
t=t.replace("view:accessUser&&!accessUser.isOwner?(accessUser.visibility?.sections?.[0]||'today'):this.state.view", "view:accessUser&&!accessUser.isOwner?(accessUser.visibility?.sections?.[0]||'restricted'):this.state.view");
t=t.replace("isEmpty: live.length===0 && s.view==='contacts'", "isEmpty: live.length===0 && s.view==='contacts'&&this.canView('contacts')");
t=t.replace("      viewTitle: s.view==='contact'", "      noSections:this.workspaceReady()&&this.isContributor()&&!s.accessUser.visibility?.sections?.length,viewTitle:s.view==='restricted'?'Your workspace': s.view==='contact'");
t=t.replace('<sc-if value="{{ workspaceReady }}">','<sc-if value="{{ workspaceReady }}"><sc-if value="{{ noSections }}"><div class="crm-system-notice"><div><strong>No sections assigned</strong><p>Ibrar can choose which parts of the CRM you can see.</p></div></div></sc-if>');
// Section-derived flags never activate through a stale link or empty permissions.
t=t.replace(/\bv([A-Z]\w*):s\.view==='([^']+)'/g,(a,name,view)=>`v${name}:this.canView('${view}')&&s.view==='${view}'`);
fs.writeFileSync(file,raw.replace(re,()=>m[1]+JSON.stringify(t).replace(/<\//g,'<\\/')+m[3]));
console.log('Workspace presentation finalized.');
