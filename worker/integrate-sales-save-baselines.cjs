'use strict';
const fs=require('node:fs'),path=require('node:path');
function transform(template){
 const before="this._snapshotEtag=this.snapshotVersion(response,value);this.setState({db:this.normalizeScopedWorkspace(value.data)});return;",after="this._snapshotEtag=this.snapshotVersion(response,value);const refreshed=this.normalizeScopedWorkspace(value.data);this.adoptSalesBaseline(refreshed);this.setState({db:refreshed});return;";
 if(template.includes(before))template=template.replace(before,after);else if(!template.includes(after))throw Error('Clean refresh baseline integration target missing.');
 const archive="this._snapshotEtag=this.snapshotVersion(response,value);const saved=value.data;",replacement=archive+"if(this.isSalesAssociate()){this._salesContactBaseline=(this._salesContactBaseline||[]).filter(row=>row.id!==id);this._salesDealBaseline=(this._salesDealBaseline||[]).filter(row=>row.contact_id!==id);}";
 if(!template.includes(replacement)){if(!template.includes(archive))throw Error('Archive baseline integration target missing.');template=template.replace(archive,replacement);}
 return template;
}
module.exports={transform};
if(require.main===module){const file=path.join(__dirname,'..','index.html'),html=fs.readFileSync(file,'utf8'),re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,match=html.match(re);if(!match)throw Error('Missing CRM template.');const template=transform(JSON.parse(match[2]));fs.writeFileSync(file,html.replace(re,()=>match[1]+JSON.stringify(template).replace(/<\//g,'<\\/')+match[3]));console.log('Canonical refresh and archive baselines integrated.');}
