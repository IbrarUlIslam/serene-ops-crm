'use strict';
const fs=require('node:fs'),path=require('node:path');
function transform(template){
 if(template.includes('  salesContactChanges(){'))return template;
 const replace=(before,after)=>{if(!template.includes(before))throw Error('Missing sales autosave target: '+before.slice(0,100));template=template.replace(before,after);};
 replace('  workspaceWritePayload(){const db=this.state.db;if(!this.isSalesAssociate())return db;const pick=(row,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));return {...db,contacts:(db.contacts||[]).map(row=>pick(row,[\'id\',\'created_at\',\'updated_at\',...this.salesContactFields()])),deals:(db.deals||[]).map(row=>pick(row,[\'id\',\'contact_id\',\'created_at\',\'updated_at\',\'stage_at\',\'no_show_count\',\'scope_ready\',...this.salesDealFields()]))};}',`  salesOtherWriteState(db){return JSON.stringify({todos:db.todos,tickets:db.tickets,social_posts:db.social_posts,business:db.business,user_prefs:db.user_prefs});}
  adoptSalesBaseline(db){this._salesContactBaseline=JSON.parse(JSON.stringify(db.contacts||[]));this._salesDealBaseline=JSON.parse(JSON.stringify(db.deals||[]));this._salesOtherBaseline=this.salesOtherWriteState(db);}
  salesRowDelta(row,old,fields,metadata){const pick=keys=>Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));if(!old)return pick([...metadata,...fields]);const changed=fields.filter(key=>Object.hasOwn(row,key)&&JSON.stringify(row[key])!==JSON.stringify(old[key]));return changed.length?pick(['id',...changed]):null;}
  workspaceWritePayload(){const db=this.state.db;if(!this.isSalesAssociate())return db;const contacts=new Map((this._salesContactBaseline||[]).map(row=>[row.id,row])),deals=new Map((this._salesDealBaseline||[]).map(row=>[row.id,row]));return {...db,contacts:(db.contacts||[]).map(row=>this.salesRowDelta(row,contacts.get(row.id),this.salesContactFields(),['id','created_at','updated_at'])).filter(Boolean),deals:(db.deals||[]).map(row=>this.salesRowDelta(row,deals.get(row.id),this.salesDealFields(),['id','contact_id','created_at','updated_at','stage_at','no_show_count','scope_ready'])).filter(Boolean)};}
  salesContactChanges(){const previous=new Map((this._salesContactBaseline||[]).map(row=>[row.id,row]));return(this.state.db?.contacts||[]).map(row=>{const old=previous.get(row.id);if(!old)return null;const delta=this.salesRowDelta(row,old,this.salesContactFields(),[]);if(!delta)return null;const {id,...patch}=delta;return{id,patch,base:Object.fromEntries(Object.keys(patch).map(key=>[key,old[key]===undefined?null:old[key]]))};}).filter(Boolean);}
  async flushSalesContactChanges(){
    if(this._saveInFlight||!this.canSaveWorkspace()||this._saveEpoch===this._savedEpoch)return;
    const epoch=this._saveEpoch,changes=this.salesContactChanges();if(!changes.length)return;
    this._saveInFlight=true;this.setState({saveStatus:'saving',saveError:''});
    try{for(const change of changes){const response=await this.apiFetch('/api/sales/contacts/'+encodeURIComponent(change.id),{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({patch:change.patch,base:change.base})});const value=await this.readWorkspaceResponse(response);if(!this.workspaceReady())return;if(!value.contact||value.contact.id!==change.id)throw Error('The CRM could not confirm the contact save. Your edits are still in this window.');
      clearTimeout(this._saveRecoveryTimer);this._saveRecoveryAttempts=0;this._snapshotEtag=this.snapshotVersion(response,value);
      const previous=(this._salesContactBaseline||[]).find(row=>row.id===change.id)||{},canonical=value.contact;
      this.setState(state=>{const current=state.db.contacts.find(row=>row.id===change.id),next={...canonical};for(const key of this.salesContactFields())if(current&&Object.hasOwn(current,key)&&JSON.stringify(current[key])!==JSON.stringify(previous[key])&&(!Object.hasOwn(change.patch,key)||JSON.stringify(current[key])!==JSON.stringify(change.patch[key])))next[key]=current[key];return{db:{...state.db,contacts:state.db.contacts.map(row=>row.id===change.id?next:row)}};});
      this._salesContactBaseline=(this._salesContactBaseline||[]).map(row=>row.id===change.id?JSON.parse(JSON.stringify(canonical)):row);
    }this._savedEpoch=epoch;this.setState({saveStatus:this._saveEpoch===epoch?'saved':'pending',saveError:'',saveConflict:false});
    }catch(error){if(this.workspaceReady()){this.setState({saveStatus:'error',saveError:error.message,saveConflict:!!error.conflict});this.scheduleSaveRecovery(error);}}
    finally{this._saveInFlight=false;}
    if(!this.state.saveError&&this._saveEpoch>this._savedEpoch)this.flushDb();
  }`);
 replace('    db=this.normalizeScopedWorkspace(db);\n    let meId=null;','    db=this.normalizeScopedWorkspace(db);this.adoptSalesBaseline(db);\n    let meId=null;');
 replace("    const epoch=this._saveEpoch,body=JSON.stringify(this.workspaceWritePayload());this._saveInFlight=true;this.setState({saveStatus:'saving',saveError:''});",`    const payload=this.workspaceWritePayload();if(this.isSalesAssociate()&&this.salesContactChanges().length&&payload.contacts.every(row=>(this._salesContactBaseline||[]).some(old=>old.id===row.id))&&!payload.deals.length&&this.salesOtherWriteState(this.state.db)===this._salesOtherBaseline)return this.flushSalesContactChanges();
    const epoch=this._saveEpoch,body=JSON.stringify(payload);this._saveInFlight=true;this.setState({saveStatus:'saving',saveError:''});`);
 replace("if(value.snapshot&&this._saveEpoch===epoch)next.db=this.normalizeScopedWorkspace(value.snapshot);this.setState(next);", "if(value.snapshot&&this._saveEpoch===epoch){next.db=this.normalizeScopedWorkspace(value.snapshot);this.adoptSalesBaseline(next.db);}this.setState(next);");
 return template;
}
module.exports={transform};
if(require.main===module){const file=path.join(__dirname,'..','index.html'),html=fs.readFileSync(file,'utf8'),re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,match=html.match(re);if(!match)throw Error('Missing CRM template.');const template=transform(JSON.parse(match[2]));fs.writeFileSync(file,html.replace(re,()=>match[1]+JSON.stringify(template).replace(/<\//g,'<\\/')+match[3]));console.log('Small sales contact autosaves integrated.');}
