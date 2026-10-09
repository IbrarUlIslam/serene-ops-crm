'use strict';
const fs=require('node:fs');
const path=require('node:path');

// Pure transformation: root owns the native file and applies this explicitly.
function removeInterfaceIcons(input){
  if(input.includes('// Text-only interface controls v1.'))return input;
  const split=input.indexOf('<script type="text/x-dc"');
  if(split<0)throw Error('Native component script not found.');
  let markup=input.slice(0,split),code=input.slice(split);
  const svgs=[...markup.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)];
  // Every native SVG is a 24x24 control/decorative icon. The real logo is the
  // named brand-mark element; native reporting charts use data bars, not SVG.
  if(svgs.some(match=>!/sc-camel-view-box="0 0 24 24"/.test(match[0])))throw Error('Unexpected SVG; inspect whether it is a chart before removing it.');
  markup=markup.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,'');
  const actions={toggleDialer:'Dialer',toggleBell:'Notifications',dialBack:'Delete last digit',calPrev:'Previous',calNext:'Next','t.toggle':'{{ t.toggleLabel }}','t.up':'Move up','t.down':'Move down'};
  markup=markup.replace(/(<button\b([^>]*)>)([\s\S]*?)(<\/button>)/gi,(whole,open,attributes,body,close)=>{
    const binding=attributes.match(/sc-camel-on-click="\{\{\s*([\w.]+)\s*\}\}"/)?.[1];
    if(binding==='toggleBell')return open+'Notifications '+body.replace(/^\s+/, '')+close;
    if(binding==='toggleDialer')return open+'Dialer'+close;
    const plain=body.replace(/<[^>]*>/g,'').trim();
    if(/^[←→↑↓×✕▸▾]$/.test(plain)){
      const label=actions[binding]||attributes.match(/aria-label="([^"]+)"/)?.[1];
      if(!label)throw Error('Icon-only button lacks a meaningful label: '+whole.slice(0,160));
      return open+label+close;
    }
    return whole;
  });
  for(const name of ['AVATAR','ICON','STAGE_ICON']){
    const re=new RegExp('  '+name+' = \\{[\\s\\S]*?\\n  \\};');
    if(!re.test(code))throw Error('Missing icon data field: '+name);
    code=code.replace(re,'  '+name+' = {};');
  }
  code=code.replace("  AVATAR = {};", "  // Text-only interface controls v1.\n  AVATAR = {};");
  code=code.replace("chevStyle:'font-size:10px;color:var(--ink-muted);transition:transform .2s ease;transform:rotate('+(collapsed?'-90deg':'0deg')+')',", "chevStyle:'font-size:10px;color:var(--ink-muted);letter-spacing:0;text-transform:none',");
  code=code.replace("chev:'▾'", "chev:collapsed?'Show':'Hide'");
  code=code.replace("expanded:!!expanded[tp.id],toggle:", "expanded:!!expanded[tp.id],toggleLabel:expanded[tp.id]?'Hide details':'View details',toggle:");
  code=code.replaceAll('width:38px;height:38px;', 'width:auto;min-width:64px;height:38px;padding:0 12px;font-size:13px;font-weight:600;gap:8px;');
  code=code.replace("trend<=0?'↓ ':'↑ '", "trend<=0?'Decrease ':'Increase '");
  // Animal/decorative pictographs are never needed for a CRM record label.
  markup=markup.replace(/\p{Extended_Pictographic}/gu,'');
  code=code.replace(/\p{Extended_Pictographic}/gu,'');
  const out=markup+code;
  if(/<svg\b/i.test(markup))throw Error('Decorative SVG remains.');
  return out;
}

module.exports={removeInterfaceIcons};
if(require.main===module){
  const file=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html'));
  const raw=fs.readFileSync(file,'utf8'),match=raw.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
  if(!match)throw Error('Bundled native template not found.');
  const before=JSON.parse(match[1]),after=removeInterfaceIcons(before);
  fs.writeFileSync(file,raw.replace(match[1],()=>JSON.stringify(after).replace(/<\//g,'<\\/')));
  console.log(after===before?'Text-only interface already applied.':'Decorative icons removed and controls labeled.');
}
