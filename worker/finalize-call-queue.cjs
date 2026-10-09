const fs=require('fs');
const path='index.html',raw=fs.readFileSync(path,'utf8'),pattern=/(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/,match=raw.match(pattern);
let template=JSON.parse(match[2]);
const before="      const uri='zoomphonecall://'+encodeURIComponent(checked.contact.phone),link=document.createElement('a');";
const after="      const dialNumber=String(checked.contact.phone).replace(/[^0-9+]/g,'');\n      const uri='zoomphonecall://'+encodeURIComponent(dialNumber),link=document.createElement('a');";
if(template.includes(before))template=template.replace(before,after);
const anchor="      else if(e.data.type==='serene-users-updated'";
if(!template.includes("e.data.type==='serene-call-queue-discarded'"))template=template.replace(anchor,"      else if(e.data.type==='serene-call-queue-discarded'&&new URL(frame.src,location.origin).pathname==='/call-queue.html'){if(this.state.zoomActiveCall?.queue&&this.state.zoomActiveCall.contactId===e.data.contactId)this.setState({zoomActiveCall:null});}\n"+anchor);
fs.writeFileSync(path,raw.replace(pattern,()=>match[1]+JSON.stringify(template).replace(/<\//g,'<\\/')+match[3]));
