const fs=require('fs');
function integrateContactCallLog(t){
 if(t.includes('// Contact manual call entry v1.'))return t;
 const replace=(a,b)=>{if(!t.includes(a))throw Error('Missing anchor: '+a.slice(0,100));t=t.replace(a,b);};
 replace("phone:c.phone||'', tel:","canLogCall:this.canView('calls')&&this.canEditSection('calls')&&!c.deleted_at&&!c.archived_at, logCall:()=>this.endCallDialog(c.id,c.phone||''), phone:c.phone||'', tel:");
 const mail='<a href="{{ cd.mailto }}"';
 replace(mail,'<sc-if value="{{ cd.canLogCall }}"><button type="button" sc-camel-on-click="{{ cd.logCall }}" style="display:block;width:100%;text-align:center;padding:10px;border:1px solid var(--ink-muted);border-radius:2px;background:white;font-weight:600;font-size:15px;cursor:pointer">Log a call</button></sc-if>\n                  '+mail);
 replace("const visibleTabDef=tabDef.filter(([tab])=>this.contactTabVisible(tab));","const visibleTabDef=tabDef.filter(([tab])=>this.contactTabVisible(tab));\n    if(this.canView('calls'))visibleTabDef.push(['calllog','Calls']);");
 replace("tFiles:tab==='files', tAccess:tab==='access', tActivity:tab==='activity'","tCallLog:tab==='calllog'&&this.canView('calls'), tFiles:tab==='files', tAccess:tab==='access', tActivity:tab==='activity'");
 replace('<sc-if value="{{ cd.tActivity }}">',`<sc-if value="{{ cd.tCallLog }}"><h3 style="font:400 23px/1.2 'Source Serif 4',serif;margin:0 0 10px">Call history</h3><p style="color:var(--ink-muted)">Recorded outcomes and notes for this contact.</p><sc-for list="{{ cd.calls }}" as="k"><article style="padding:16px 0;border-top:1px solid var(--rule)"><strong>{{ k.outcome }}</strong><p style="white-space:pre-wrap;margin:8px 0">{{ k.note }}</p><small>{{ k.when }} · {{ k.by }}</small></article></sc-for><sc-if value="{{ cd.callsEmpty }}"><p>No calls logged yet.</p></sc-if></sc-if>\n              <sc-if value="{{ cd.tActivity }}">`);
 replace('  async saveStaffManualCall(d){','  // Contact manual call entry v1.\n  async saveStaffManualCall(d){');
 replace("const permitted=()=>this.workspaceReady()&&this.isContributor()&&this.canEditSection('calls')","const permitted=()=>this.workspaceReady()&&this.canView('calls')&&this.canEditSection('calls')");
 replace("if(this.isContributor())return this.saveStaffManualCall(d);","if(d.contact_id)return this.saveStaffManualCall(d);");
 replace("if(kind==='callend'&&this.isContributor())return this.saveStaffManualCall(d);","if(kind==='callend'&&d.contact_id)return this.saveStaffManualCall(d);");
 replace("if(this.isContributor()&&['Connected','Call back later'].includes(d.outcome))","if(d.contact_id&&['Connected','Call back later'].includes(d.outcome))");
 t=t.replaceAll('Inactive clients and due callbacks, ordered by availability. Their local time and your PKT time.','All permitted contacts, ordered by local calling hours. Set follow-ups with reminders or tasks.').replaceAll('Reach inactive clients during their available hours.','Call permitted contacts during their available hours.');
 return t;
}
function patchFile(path='index.html'){const raw=fs.readFileSync(path,'utf8'),p=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(p);fs.writeFileSync(path,raw.replace(p,()=>m[1]+JSON.stringify(integrateContactCallLog(JSON.parse(m[2]))).replace(/<\//g,'<\\/')+m[3]));}
module.exports={integrateContactCallLog,patchFile};if(require.main===module)patchFile();
