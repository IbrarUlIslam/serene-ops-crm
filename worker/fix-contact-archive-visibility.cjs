const fs=require('node:fs'),path=require('node:path');
function repairContactArchiveVisibility(template){
 if(!template.includes('<!-- Contact archive visibility v2. -->')){
  const prefix='<sc-if value="{{ canManageRecords }}"><div style="border:0;border-top:2px solid var(--ink-deep);background:none;border-top:0;border-radius:0;padding:14px 0 0">',suffix='\n              </div></sc-if>',start=template.indexOf(prefix),end=template.indexOf(suffix,start);
  if(start<0||end<start)throw Error('Contact archive permission wrapper not found.');
  const block=template.slice(start,end+suffix.length);if(!block.includes('sc-camel-on-click="{{ cd.remove }}"')||!block.includes('{{ cd.priceHistory }}'))throw Error('Contact archive permission wrapper is not the expected section.');
  const priceStart=block.indexOf('<button type="button" sc-camel-on-click="{{ openPrice }}"'),priceEnd=block.indexOf('</sc-for>',priceStart)+9;if(priceStart<0||priceEnd<priceStart)throw Error('Contact price controls not found.');
  let next=block.slice(0,priceStart)+'<sc-if value="{{ canManageRecords }}">'+block.slice(priceStart,priceEnd)+'</sc-if>'+block.slice(priceEnd);
  next=next.replace(prefix,prefix.replace('canManageRecords','canManageSalesContact'));
  template=template.replace(block,()=>'<'+ '!-- Contact archive visibility v2. -->\n              '+next);
 }
 template=template.replace('Ibrar can restore the contact and review your reason.','A CRM administrator can restore the contact and review your reason.').replace('Contact archived. Your reason is saved for Ibrar.','Contact archived. Your reason is saved for review.').replace('Keeps their deals, tickets, tasks, reminders, notes, documents and access history intact. Restore from Settings.','Keeps all linked records and history intact. CRM administrators can restore it from Settings.');
 return template;
}
module.exports={repairContactArchiveVisibility};
if(require.main===module){const file=path.resolve(__dirname,'../index.html'),html=fs.readFileSync(file,'utf8'),match=html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);if(!match)throw Error('CRM template not found.');const old=JSON.parse(match[1]),next=repairContactArchiveVisibility(old);if(next!==old)fs.writeFileSync(file,html.replace(match[1],()=>JSON.stringify(next).replace(/<\/script/gi,'<\\/script')));console.log(old===next?'Contact archive visibility already repaired.':'Editable Sales contact archive is now visible; price controls remain administrator-only.');}
