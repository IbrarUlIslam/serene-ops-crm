'use strict';
const fs=require('node:fs'),path=require('node:path'),file=path.join(__dirname,'..','index.html');
const raw=fs.readFileSync(file,'utf8'),re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(re);let t=JSON.parse(m[2]);
if(!t.includes('  snapshotVersion(response,value){'))t=t.replace('  workspaceReady(){',`  snapshotVersion(response,value){const stamp=value?.updatedAt!==undefined?value.updatedAt:value?.data?.updatedAt;return stamp!==undefined?JSON.stringify(stamp||'empty'):String(response.headers.get('ETag')||'"empty"').replace(/^W\\//,'');}
  workspaceReady(){`);
t=t.replace("res.headers.get('ETag')||JSON.stringify(j.updatedAt||'empty')",'this.snapshotVersion(res,j)').replace("r.headers.get('ETag')||JSON.stringify(value.data?.updatedAt||'empty')",'this.snapshotVersion(r,value)').replace("response.headers.get('ETag')||JSON.stringify(value.updatedAt||'empty')",'this.snapshotVersion(response,value)');
fs.writeFileSync(file,raw.replace(re,()=>m[1]+JSON.stringify(t).replace(/<\//g,'<\\/')+m[3]));console.log('Autosaves use the authoritative snapshot version.');
