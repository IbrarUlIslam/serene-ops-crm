const fs=require('node:fs');
const {repairContactArchiveVisibility}=require('./fix-contact-archive-visibility.cjs');
const methods=String.raw`
  // Contact archive with reason v1.
  openContactArchive(id){
    if(!this.requireSalesContact())return;
    const contact=(this.state.db?.contacts||[]).find(row=>row.id===id&&!row.deleted_at&&!row.archived_at);if(!contact)return this.toast('This contact is no longer available.');
    if(this._contactArchiveDialog?.isConnected)return this._contactArchiveDialog.focus();
    const opener=document.activeElement,dialog=document.createElement('dialog'),form=document.createElement('form'),title=document.createElement('h2'),intro=document.createElement('p'),label=document.createElement('label'),reason=document.createElement('textarea'),notice=document.createElement('p'),actions=document.createElement('div'),cancel=document.createElement('button'),submit=document.createElement('button');
    dialog.setAttribute('aria-labelledby','contact-archive-title');dialog.setAttribute('aria-describedby','contact-archive-description');dialog.style.cssText='width:min(500px,calc(100vw - 40px));box-sizing:border-box;padding:28px;border:1px solid #d8dce0;border-radius:4px;background:#fff;color:#4c484f;font-family:Source Sans 3,sans-serif;box-shadow:0 20px 60px rgba(58,55,61,.2)';
    title.id='contact-archive-title';title.textContent='Archive contact';title.style.cssText='margin:0;font:400 27px/1.2 Source Serif 4,serif;color:#3a373d';
    intro.id='contact-archive-description';intro.textContent=contact.name+' will leave active contacts and calling lists. Ibrar can restore the contact and review your reason. Existing records and history are retained.';intro.style.cssText='margin:14px 0 22px;font-size:15px;line-height:1.5';
    label.textContent='Reason for archiving';label.htmlFor='contact-archive-reason';label.style.cssText='display:block;margin-bottom:8px;font-size:14px;font-weight:600';
    reason.id='contact-archive-reason';reason.required=true;reason.maxLength=2000;reason.rows=5;reason.placeholder='Explain why this contact should be archived.';reason.style.cssText='width:100%;box-sizing:border-box;padding:11px;border:1px solid #d8dce0;border-radius:2px;background:#fff;color:#4c484f;font:inherit;resize:vertical';
    notice.setAttribute('role','alert');notice.hidden=true;notice.style.cssText='margin:12px 0;color:#a4453a;font-size:14px;line-height:1.45';actions.style.cssText='display:flex;justify-content:flex-end;gap:10px;margin-top:22px';
    cancel.type='button';cancel.textContent='Cancel';cancel.style.cssText='padding:9px 15px;border:1px solid #d8dce0;border-radius:2px;background:#fff;color:#4c484f;font:inherit;cursor:pointer';
    submit.type='submit';submit.textContent='Archive contact';submit.style.cssText='padding:9px 15px;border:1px solid #a4453a;border-radius:2px;background:#a4453a;color:#fff;font:inherit;font-weight:600;cursor:pointer';
    const close=()=>{if(this._contactArchiveBusy)return;dialog.close();};cancel.addEventListener('click',close);dialog.addEventListener('cancel',event=>{if(this._contactArchiveBusy)event.preventDefault();});
    dialog.addEventListener('close',()=>{dialog.remove();if(this._contactArchiveDialog===dialog)this._contactArchiveDialog=null;if(opener?.isConnected)opener.focus();});
    form.addEventListener('submit',async event=>{event.preventDefault();if(this._contactArchiveBusy)return;const value=reason.value.trim();if(!value){notice.hidden=false;notice.textContent='Enter a reason before archiving.';reason.focus();return;}if(!form.reportValidity())return;submit.disabled=true;cancel.disabled=true;reason.disabled=true;submit.textContent='Archiving…';notice.hidden=true;
      try{await this.submitContactArchive(id,value);dialog.close();}catch(error){notice.hidden=false;notice.textContent=error.message||'The contact could not be archived.';}finally{submit.disabled=false;cancel.disabled=false;reason.disabled=false;submit.textContent='Archive contact';}
    });
    actions.append(cancel,submit);form.append(title,intro,label,reason,notice,actions);dialog.append(form);document.body.append(dialog);this._contactArchiveDialog=dialog;dialog.showModal();reason.focus();
  }
  async submitContactArchive(id,reason){
    if(this._contactArchiveBusy)return false;if(!this.canManageSalesContact()||!this.canSaveWorkspace())throw Error('Reload your workspace and check your Contacts edit permission.');
    reason=String(reason||'').trim();if(!reason||reason.length>2000)throw Error('Enter an archive reason of up to 2,000 characters.');
    this._contactArchiveBusy=true;
    try{if(this._saveInFlight||this._saveEpoch!==this._savedEpoch){await this.flushDb();if(this._saveInFlight||this._saveEpoch!==this._savedEpoch)throw Error(this.state.saveError||'Wait for your changes to finish saving, then archive the contact.');}
      const contact=(this.state.db?.contacts||[]).find(row=>row.id===id&&!row.deleted_at&&!row.archived_at);if(!contact)throw Error('This contact is no longer available.');
      const response=await this.apiFetch('/api/contact-archive',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','If-Match':this._snapshotEtag||''},body:JSON.stringify({contactId:id,reason})});const value=await response.json();if(!response.ok)throw Error(value.error||'The contact could not be archived.');if(!this.workspaceReady())throw Error('Your access changed. Reload the workspace.');
      this._snapshotEtag=this.snapshotVersion(response,value);const saved=value.data;
      this.setState(state=>{const db={...state.db};if(this.isSalesAssociate()){db.contacts=(db.contacts||[]).filter(row=>row.id!==id);db.deals=(db.deals||[]).filter(row=>row.contact_id!==id);}else db.contacts=(db.contacts||[]).map(row=>row.id===id?{...row,deleted_at:saved.at,archive_reason:saved.reason,archived_by:saved.by,archived_by_user_id:saved.byUserId,updated_at:saved.at,archive_history:[...(Array.isArray(row.archive_history)?row.archive_history:[]),{action:'Archived',at:saved.at,by:saved.by,by_user_id:saved.byUserId,reason:saved.reason}]}:row);if(saved.activity)db.activity=[saved.activity,...(db.activity||[])];return{db,view:'contacts',contactId:null,editing:false,saveStatus:this._saveEpoch===this._savedEpoch?'saved':'pending',saveError:'',saveConflict:false};});this.clearBulk('contacts');this.toast('Contact archived. Your reason is saved for Ibrar.');return true;
    }finally{this._contactArchiveBusy=false;}
  }
  restoreArchivedContactDb(db,id){const contact=(db.contacts||[]).find(row=>row.id===id);if(!contact)return;const at=new Date().toISOString();contact.deleted_at=null;contact.archived_at=null;contact.updated_at=at;contact.archive_history=[...(Array.isArray(contact.archive_history)?contact.archive_history:[]),{action:'Restored',at,by:this.actor(),by_user_id:this.state.accessUser?.id||this.state.meId}];}
`;

function transformContactArchiveTemplate(template){
 if(template.includes('// Contact archive with reason v1.'))return repairContactArchiveVisibility(template);
 const replace=(from,to)=>{if(!template.includes(from))throw Error('Contact archive integration anchor missing: '+from.slice(0,100));template=template.replace(from,to);};
 const oldDelete=template.match(/^  deleteContact\(id\)\{[^\n]*\}$/m)?.[0];if(!oldDelete)throw Error('Contact archive delete method missing.');replace(oldDelete,"  deleteContact(id){this.openContactArchive(id);}"+methods);
 replace("remove:()=>{ if(this.isContributor()) return this.toast('Archiving contacts is Owner/Admin.'); this.deleteContact(c.id); },","remove:()=>this.deleteContact(c.id),");
 replace('<sc-if value="{{ canManageRecords }}"><button type="button" sc-camel-on-click="{{ cd.remove }}"','<sc-if value="{{ canManageSalesContact }}"><button type="button" sc-camel-on-click="{{ cd.remove }}"');
 replace("name:c.name,when:this.relDay(c.deleted_at),selected:this.isBulkSelected('archiveContacts',c.id)","name:c.name,reason:c.archive_reason||'No reason recorded',by:c.archived_by||'Legacy archive',when:this.stamp(c.deleted_at,this.PKT)+' PKT',selected:this.isBulkSelected('archiveContacts',c.id)");
 const archivedBlock=template.match(/<sc-for list="\{\{ archivedContacts \}\}" as="c">[\s\S]*?<\/sc-for>/)?.[0];if(!archivedBlock)throw Error('Owner archived contacts block missing.');replace(archivedBlock,archivedBlock.replace('grid-template-columns:24px 1fr 110px 70px 100px','grid-template-columns:24px minmax(180px,1fr) 155px 70px 100px').replace('<span>{{ c.name }}</span>','<div style="min-width:0"><strong style="font-size:15px;font-weight:600">{{ c.name }}</strong><div style="font-size:14px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:5px">{{ c.reason }}</div><div style="font-size:13px;color:var(--ink-muted);margin-top:4px">Archived by {{ c.by }}</div></div>'));
 replace('Normal delete means Archive. Restoring a contact restores only the contact; linked items are restored individually.','Archived contacts retain their reason and history. Restore reactivates the contact; previously archived linked items are restored separately.');
 replace("  restoreContactOnly(id){this.commit(db=>{const c=db.contacts.find(x=>x.id===id);if(c)c.deleted_at=null;db.__ctx=id;},'Contact restored');}","  restoreContactOnly(id){if(!this.requireOwner())return;this.commit(db=>{this.restoreArchivedContactDb(db,id);db.__ctx=id;},'Contact restored');}");
 replace("  restoreContacts(ids){if(!ids||!ids.length)return;this.commit(db=>ids.forEach(id=>{const c=(db.contacts||[]).find(x=>x.id===id);if(c)c.deleted_at=null;}),'Contacts restored');this.clearBulk('archiveContacts');this.toast('Selected contacts restored. Linked records remain archived.');}","  restoreContacts(ids){if(!this.requireOwner()||!ids||!ids.length)return;this.commit(db=>ids.forEach(id=>this.restoreArchivedContactDb(db,id)),'Contacts restored');this.clearBulk('archiveContacts');this.toast('Selected contacts restored. Existing linked archive items remain in Archive.');}");
 return repairContactArchiveVisibility(template);
}

function replaceBundledTemplate(html,next){const match=html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);if(!match)throw Error('CRM template missing.');return html.replace(match[1],()=>JSON.stringify(next).replace(/<\/script>/g,'<\\/script>'));}
module.exports={transformContactArchiveTemplate,replaceBundledTemplate};
if(require.main===module){const path=require('node:path').resolve(__dirname,'../index.html'),html=fs.readFileSync(path,'utf8'),match=html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);if(!match)throw Error('CRM template missing.');const old=JSON.parse(match[1]),next=transformContactArchiveTemplate(old);if(next!==old)fs.writeFileSync(path,replaceBundledTemplate(html,next));console.log(next===old?'Contact archive integration already applied.':'Contact archive reason interface integrated.');}
