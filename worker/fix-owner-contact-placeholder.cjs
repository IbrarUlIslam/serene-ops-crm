'use strict';
const fs=require('node:fs'),path=require('node:path');
function fixOwnerContactPlaceholder(source){
  const before="value: !this.isContributor()&&c.status==='Client'?this.valueLabel(c):'',",after="value: this.isContributor()?'':c.status==='Client'?this.valueLabel(c):'—',";
  if(source.includes(after))return source;
  if(!source.includes(before))throw Error('Owner contact placeholder anchor changed.');
  return source.replace(before,after);
}
module.exports={fixOwnerContactPlaceholder};
if(require.main===module){const file=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html')),html=fs.readFileSync(file,'utf8'),match=html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);if(!match)throw Error('Native template missing.');const before=JSON.parse(match[1]),after=fixOwnerContactPlaceholder(before);fs.writeFileSync(file,html.replace(match[1],()=>JSON.stringify(after).replace(/<\//g,'<\\/')));console.log(after===before?'Owner contact placeholders already restored.':'Owner contact placeholders restored.');}
