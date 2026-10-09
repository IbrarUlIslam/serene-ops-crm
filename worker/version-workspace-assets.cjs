'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),version='20261007-2';
for(const name of ['audits.html','users.html','audit-connectors.html']){const file=path.join(root,name);let s=fs.readFileSync(file,'utf8');s=s.replace(/(href|src)="([^"?]+\.(?:css|js))(?:\?v=[^"]*)?"/g,(_,attribute,url)=>`${attribute}="${url}?v=${version}"`);fs.writeFileSync(file,s);}
for(const name of ['audits.css','audit-connectors.css']){const file=path.join(root,name);let s=fs.readFileSync(file,'utf8');s=s.replace(/url\((['"])(\/(?:brand|workspace-screens)\.css)(?:\?v=[^'"]*)?\1\)/g,(_,quote,url)=>`url(${quote}${url}?v=${version}${quote})`);fs.writeFileSync(file,s);}
const file=path.join(root,'index.html'),raw=fs.readFileSync(file,'utf8'),re=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,m=raw.match(re);let t=JSON.parse(m[2]);
t=t.replace(/href="\/brand\.css(?:\?v=[^"]*)?"/g,`href="/brand.css?v=${version}"`);
t=t.replace("  async componentDidMount(){",`  async componentDidMount(){
    this.ICON.audits='M5 3h14v18H5zM8 7h8M8 11h8M8 15h4';this.ICON.users='M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M16 3a4 4 0 010 8M22 21v-2a4 4 0 00-3-3.87M13 7a4 4 0 11-8 0 4 4 0 018 0';`);
fs.writeFileSync(file,raw.replace(re,()=>m[1]+JSON.stringify(t).replace(/<\//g,'<\\/')+m[3]));
console.log('Workspace assets versioned for a consistent release.');
