'use strict';
const fs=require('node:fs'),path=require('node:path');
function whiteWorkspace(source){
  source=source.replace(/#(?:fdf6e3|fffaf0|fffdfa)/gi,'#FFFFFF').replace(/#cbc0b6/gi,'#D8DCE0').replaceAll('rgba(203,192,182,','rgba(216,220,224,');
  if(source.includes('// Audit document refresh race guard v1.'))return source;
  const before=`  async refreshAuditDocuments(){
    try{const response=await this.apiFetch('/api/db');if(!response.ok)return;const value=await response.json();if(this._saveEpoch===this._savedEpoch&&!this._saveInFlight){this._snapshotEtag=this.snapshotVersion(response,value);this.setState({db:this.normalizeScopedWorkspace(value.data)});return;}const generated=(value.data?.files||[]).filter(f=>f.audit_report_id);this.setState(s=>({db:s.db?{...s.db,files:[...(s.db.files||[]).filter(f=>!f.audit_report_id),...generated]}:s.db}));}catch(e){this.toast('Could not refresh audit documents.');}
  }`;
  const after=`  // Audit document refresh race guard v1.
  async refreshAuditDocuments(){
    if(!this.workspaceReady())return;
    const identity=this.state.accessUser.id||this.state.accessUser.email,epoch=this._saveEpoch,revision=this._snapshotEtag;
    const current=()=>this.workspaceReady()&&identity===(this.state.accessUser.id||this.state.accessUser.email);
    try{const response=await this.apiFetch('/api/db');if(!response.ok)return;const value=await response.json();if(!current()||!Array.isArray(value.data?.contacts))return;
      if(this._saveEpoch===epoch&&this._saveEpoch===this._savedEpoch&&!this._saveInFlight&&this._snapshotEtag===revision){this._snapshotEtag=this.snapshotVersion(response,value);this.setState({db:this.normalizeScopedWorkspace(value.data)});return;}
      const generated=(value.data.files||[]).filter(f=>f.audit_report_id);this.setState(s=>({db:s.db?{...s.db,files:[...(s.db.files||[]).filter(f=>!f.audit_report_id),...generated]}:s.db}));
    }catch(e){if(current())this.toast('Could not refresh audit documents.');}
  }`;
  if(!source.includes(before))throw Error('Audit document refresh source missing.');
  return source.replace(before,after);
}
module.exports={whiteWorkspace};
if(require.main===module){const file=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html')),raw=fs.readFileSync(file,'utf8'),re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(re);if(!m)throw Error('Bundled template missing.');const before=JSON.parse(m[2]),after=whiteWorkspace(before);fs.writeFileSync(file,raw.replace(re,()=>m[1]+JSON.stringify(after).replace(/<\//g,'<\\/')+m[3]));console.log(after===before?'White workspace already applied.':'White workspace and audit document refresh applied.');}
