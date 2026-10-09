// Patch the decoded CRM template, then preserve its existing bundler format.
const fs=require('fs');const file='index.html';let raw=fs.readFileSync(file,'utf8');const pattern=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;const match=raw.match(pattern);if(!match)throw Error('CRM template not found');let template=JSON.parse(match[2]);
function replace(from,to){if(!template.includes(from))throw Error('Missing integration anchor: '+from.slice(0,100));template=template.replace(from,to);}
if(!template.includes('vAudits:s.view')){
 replace("['contacts','Contacts',live.length]","['contacts','Contacts',live.length],['audits','Audits',null]");
 replace("const titles={today:","const titles={audits:['Audits','Public review, meeting answers and proposed services.'],today:");
 replace("vDash:s.view==='dashboard'","vAudits:s.view==='audits', auditFrameUrl:'/audits.html'+(s.auditContactId?'?contact='+encodeURIComponent(s.auditContactId):''), vDash:s.view==='dashboard'");
 replace('<sc-if value="{{ vDash }}">','<sc-if value="{{ vAudits }}"><iframe src="{{ auditFrameUrl }}" title="Contact audits" style="width:100%;height:calc(100vh - 190px);min-height:650px;border:0;background:#fdf6e3"></iframe></sc-if>\n<sc-if value="{{ vDash }}">');
 replace('addDoc:()=>this.setState({modal:\'document\'', 'generateAudit:()=>this.auditForContact(c.id), addDoc:()=>this.setState({modal:\'document\'');
 replace('<button type="button" sc-camel-on-click="{{ cd.addDoc }}"','<button type="button" sc-camel-on-click="{{ cd.generateAudit }}" style="padding:8px 14px;border:1px solid var(--rule);background:none;color:var(--ink);cursor:pointer">Generate audit</button><button type="button" sc-camel-on-click="{{ cd.addDoc }}"');
 replace("go:()=>this.setState({tab:k, editing:false})","go:()=>{this.setState({tab:k, editing:false});if(k==='files')this.refreshAuditDocuments();}");
 replace('async componentDidMount(){','async componentDidMount(){\n    this._auditMessage=e=>{if(e.origin===location.origin&&e.data&&e.data.type===\'serene-audit-documents-updated\')this.refreshAuditDocuments();};window.addEventListener(\'message\',this._auditMessage);');
 replace('  apiFetch(path, options){',`  async auditForContact(id){
    try{const response=await this.apiFetch('/api/audits/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contactId:id})});const value=await response.json();if(!response.ok)throw Error(value.error||'Audit generation failed.');this.setState({view:'audits',auditContactId:id,editing:false});}catch(e){this.toast(e.message);}
  }
  async refreshAuditDocuments(){
    try{const response=await this.apiFetch('/api/db');if(!response.ok)return;const value=await response.json();const generated=(value.data?.files||[]).filter(f=>f.audit_report_id);this.setState(s=>({db:s.db?{...s.db,files:[...(s.db.files||[]).filter(f=>!f.audit_report_id),...generated]}:s.db}));}catch(e){this.toast('Could not refresh audit documents.');}
  }
  apiFetch(path, options){`);
 // Generated versions cannot be removed through the mutable document index.
 replace('name:f.name, kind:f.kind, size:f.size||', 'name:f.name, kind:f.kind, canRemove:!f.audit_report_id, size:f.size||');
 replace('<button type="button" sc-camel-on-click="{{ f.remove }}" style="background:none;border:0;padding:0;font-size:14px;font-weight:600;color:var(--critical);cursor:pointer">Remove</button>','<sc-if value="{{ f.canRemove }}"><button type="button" sc-camel-on-click="{{ f.remove }}" style="background:none;border:0;padding:0;font-size:14px;font-weight:600;color:var(--critical);cursor:pointer">Remove</button></sc-if>');
 // Use the native Audit navigation instead of the earlier injected link.
 template=template.replace('<script src="/audit-connectors-nav.js" defer></script>','');
 const encoded=JSON.stringify(template).replace(/<\//g,'<\\/');raw=raw.replace(pattern,()=>match[1]+encoded+match[3]);fs.writeFileSync(file,raw);console.log('Audit section and contact Documents integration added.');
}else console.log('Audit integration already present.');
