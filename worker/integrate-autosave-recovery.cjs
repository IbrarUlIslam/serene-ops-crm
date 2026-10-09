'use strict';
// Run explicitly after other template edits. The transformation is exported so
// recovery behavior can be tested without modifying the production template.
const fs=require('node:fs'),path=require('node:path');
function transform(template){
  if(template.includes('  async readWorkspaceResponse(response){'))return template;
  const replace=(before,after)=>{if(!template.includes(before))throw Error('Missing autosave integration target: '+before.slice(0,90));template=template.replace(before,after);};
  replace('sc-camel-on-change="{{ cd.onSalesNotes }}"','sc-camel-on-input="{{ cd.onSalesNotes }}"');
  replace('      if (r.status === 401) this.handleAccessSessionExpiry();',`      // Keep unsaved work in this window while the user restores their session.
      if (r.status === 401 && !(this._saveEpoch>this._savedEpoch)) this.handleAccessSessionExpiry();`);
  replace('  persistDb(){',`  async readWorkspaceResponse(response){
    const type=String(response.headers?.get('content-type')||'').toLowerCase();
    const status=Number(response.status)||0,redirected=!!response.redirected;
    const session=()=>Object.assign(Error('Your sign-in needs to be renewed. Your edits are still in this window. Open the CRM in another tab, sign in, then retry saving here.'),{sessionExpired:true});
    let value;
    if(type&&!type.includes('application/json')&&!type.includes('+json')){
      let accessRedirect=false;try{const url=new URL(response.url||'',location.origin);accessRedirect=url.hostname.endsWith('.cloudflareaccess.com')||url.pathname.startsWith('/cdn-cgi/access/');}catch(e){}
      if(status===401||status===403||redirected&&accessRedirect)throw session();
      const error=Error(status>=500?'The save service is temporarily unavailable. Your edits are still in this window.':'The CRM could not confirm the save. Your edits are still in this window. Retry saving.');
      error.retryable=status===429||status>=500;error.status=status;throw error;
    }
    try{value=await response.json();}catch(e){const error=Error('The CRM could not confirm the save. Your edits are still in this window. Retry saving.');error.retryable=status>=500;throw error;}
    if(status===401)throw session();
    if(!response.ok){const error=Error(value?.error||'Your changes could not be saved.');error.conflict=[409,428].includes(status);error.retryable=status===429||status>=500;error.status=status;throw error;}
    // A successful HTTP response is not enough: acknowledge only a real write.
    if(value?.data?.ok!==true)throw Error('The CRM could not confirm the save. Your edits are still in this window. Retry saving.');
    return value;
  }
  scheduleSaveRecovery(error){
    if((!error.retryable&&error.name!=='TypeError')||!this.canSaveWorkspace()||this._saveEpoch===this._savedEpoch)return;
    const attempt=(this._saveRecoveryAttempts||0)+1;if(attempt>3)return;this._saveRecoveryAttempts=attempt;
    clearTimeout(this._saveRecoveryTimer);this._saveRecoveryTimer=setTimeout(()=>{if(!this.canSaveWorkspace()||this._saveEpoch===this._savedEpoch)return;this.setState({saveError:'',saveStatus:'pending'},()=>this.flushDb());},[1000,3000,8000][attempt-1]);
  }
  persistDb(){`);
  replace("const value=await r.json();if(!this.workspaceReady())return;if(!r.ok){const e=Error(value.error||'Your changes could not be saved.');e.conflict=[409,428].includes(r.status);throw e;}","const value=await this.readWorkspaceResponse(r);if(!this.workspaceReady())return;");
  replace('      this._snapshotEtag=this.snapshotVersion(r,value);this._savedEpoch=epoch;',"      clearTimeout(this._saveRecoveryTimer);this._saveRecoveryAttempts=0;this._snapshotEtag=this.snapshotVersion(r,value);this._savedEpoch=epoch;");
  replace("try{const r=await this.apiFetch('/api/me');if(!r.ok){if([401,403].includes(r.status))", "try{const r=await this.apiFetch('/api/me');if(!r.ok){if(r.status===401&&this._saveEpoch>this._savedEpoch){this.setState({saveStatus:'error',saveError:'Your sign-in needs to be renewed. Your edits are still in this window. Open the CRM in another tab, sign in, then retry saving here.'});return;}if([401,403].includes(r.status))");
  replace('componentWillUnmount(){clearTimeout(this.timer);','componentWillUnmount(){clearTimeout(this._saveRecoveryTimer);clearTimeout(this.timer);');
  replace("}catch(e){this.setState({saveStatus:'error',saveError:e.message,saveConflict:!!e.conflict});}\n    finally{this._saveInFlight=false;}","}catch(e){if(this.workspaceReady()){this.setState({saveStatus:'error',saveError:e.message,saveConflict:!!e.conflict});this.scheduleSaveRecovery(e);}}\n    finally{this._saveInFlight=false;}");
  return template;
}
module.exports={transform};
if(require.main===module){const file=path.join(__dirname,'..','index.html'),html=fs.readFileSync(file,'utf8'),re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,match=html.match(re);if(!match)throw Error('Missing CRM template.');const template=transform(JSON.parse(match[2]));fs.writeFileSync(file,html.replace(re,()=>match[1]+JSON.stringify(template).replace(/<\//g,'<\\/')+match[3]));console.log('Autosave recovery and typing events integrated.');}
