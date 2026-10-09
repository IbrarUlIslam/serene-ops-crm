'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const runtimeId = 'a7d463f2-4e00-4aa4-83bf-f6394318e018';
const manifestPattern = /<script type="__bundler\/manifest">([\s\S]*?)<\/script>/;
const templatePattern = /<script type="__bundler\/template">([\s\S]*?)<\/script>/;

function fixNativeSelectBundle(input) {
  const manifestMatch = input.match(manifestPattern), templateMatch = input.match(templatePattern);
  if (!manifestMatch || !templateMatch) throw Error('Missing native bundle data.');
  const manifest = JSON.parse(manifestMatch[1]), entry = manifest[runtimeId];
  if (!entry) throw Error('Missing native runtime.');
  let runtime = (entry.compressed ? zlib.gunzipSync(Buffer.from(entry.data,'base64')) : Buffer.from(entry.data,'base64')).toString('utf8');
  if (!runtime.includes('option: "sc-raw-option"')) {
    const anchor = '    select: "sc-raw-select",';
    if (!runtime.includes(anchor)) throw Error('Native select wrapper anchor changed.');
    runtime = runtime.replace(anchor, anchor+'\n    // Keep option nodes inert until sc-for has established its scope.\n    option: "sc-raw-option",\n    optgroup: "sc-raw-optgroup",');
    entry.data = (entry.compressed ? zlib.gzipSync(Buffer.from(runtime)) : Buffer.from(runtime)).toString('base64');
  }
  let template = JSON.parse(templateMatch[1]);
  // Initial DOMParser runs before the runtime compiler. Protect option nodes
  // in this first pass too, while preserving static choices and every loop.
  const logicStart = template.indexOf('<script type="text/x-dc"');
  if (logicStart < 0) throw Error('Native logic anchor changed.');
  const markup = template.slice(0,logicStart).replace(/<(\/?)(option|optgroup)(?=[\s>])/gi, (_,close,tag)=>'<'+close+'sc-raw-'+tag.toLowerCase());
  template = markup + template.slice(logicStart);
  if (!template.includes("statusOpts:['All'].concat(this.CSTAT).map(v=>")) template = template.replace("statusOpts:['All'].concat(this.CSTAT)", "statusOpts:['All'].concat(this.CSTAT).map(v=>({v,l:v==='All'?'All statuses':v}))");
  const encode = value => JSON.stringify(value).replace(/<\//g,'<\\/');
  return input.replace(manifestPattern,()=>'<script type="__bundler/manifest">'+encode(manifest)+'</script>').replace(templatePattern,()=>'<script type="__bundler/template">'+encode(template)+'</script>');
}

module.exports = {fixNativeSelectBundle,runtimeId};
if (require.main === module) {
  const file = path.resolve(__dirname,'../index.html');
  fs.writeFileSync(file,fixNativeSelectBundle(fs.readFileSync(file,'utf8')));
  process.stdout.write('Native option wrappers and contact status choices repaired.\n');
}
