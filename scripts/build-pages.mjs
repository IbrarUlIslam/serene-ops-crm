import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const FRONTEND_FILES=['index.html','brand.css','workspace-screens.css','embedded.js','audits.html','audits.js','audits.css','audit-connectors.html','audit-connectors.js','audit-connectors.css','audit-connectors-nav.js','call-queue.html','call-queue.js','call-queue.css','users.html','users.js','_headers','assets/serene-logo.png','assets/source-sans-3-latin.woff2','assets/source-serif-4-latin.woff2'];
export function buildPages(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
  const destination=path.join(root,'public');
  // Refuse unexpected output files instead of accidentally publishing them.
  if(fs.existsSync(destination)){for(const relative of fs.readdirSync(destination,{recursive:true})){const file=path.join(destination,relative);if(fs.statSync(file).isFile()&&!FRONTEND_FILES.includes(relative.split(path.sep).join('/')))throw Error('Unexpected build output: '+relative);}}
  for(const relative of FRONTEND_FILES){const source=path.join(root,relative);if(!fs.statSync(source).isFile())throw Error('Missing frontend asset: '+relative);}
  fs.mkdirSync(path.join(destination,'assets'),{recursive:true});
  for(const relative of FRONTEND_FILES)fs.copyFileSync(path.join(root,relative),path.join(destination,relative));
  return destination;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){console.log('Frontend-only build ready: '+buildPages());}
