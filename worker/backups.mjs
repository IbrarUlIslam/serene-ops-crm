// The business backup is private R2 data. Credentials and active sessions require
// reconnection after recovery; Cloudflare D1 Time Travel remains the full-DB path.
const excluded = name => /^(?:sqlite_|_cf_)/i.test(name) || ['d1_migrations','sessions','zoho_oauth_tokens','zoho_oauth_state'].includes(name) || /oauth_tokens|session_tokens/.test(name);
export async function pruneOldBackups(env,nowIso,retentionDays=45) {
  const cutoff = new Date(Date.parse(nowIso)-retentionDays*86400000).toISOString().replace(/[:.]/g,'-');
  let cursor;
  do {
    const page = await env.FILES.list({prefix:'backups/',...(cursor?{cursor}:{})});
    const expired = (page.objects||[]).filter(obj=>obj.key.slice(8)<cutoff).map(obj=>obj.key);
    for(let at=0;at<expired.length;at+=1000)await env.FILES.delete(expired.slice(at,at+1000));
    if(page.truncated&&!page.cursor)throw Error('Backup retention listing did not provide its next page.');
    cursor=page.truncated?page.cursor:undefined;
  } while(cursor);
}
export async function runNightlyBackup(env) {
  const inventory=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const tableNames=(inventory.results||[]).map(x=>x.name).filter(name=>!excluded(name));
  if(!tableNames.length)throw Error('No business tables found for backup.');
  const tables={},errors={};
  for(const table of tableNames){
    try {
      const result=await env.DB.prepare('SELECT * FROM "'+table.replace(/"/g,'""')+'"').all();
      if(result.success===false)throw Error('Database table export failed.');
      tables[table]=(result.results||[]).map(row=>{if(table!=='users')return row;const copy={...row};delete copy.password_hash;return copy;});
    }catch(error){errors[table]=error.message;}
  }
  const timestamp=new Date().toISOString(),complete=!Object.keys(errors).length;
  const payload={formatVersion:2,backedUpAt:timestamp,status:complete?'complete':'partial',tableCount:Object.keys(tables).length,rowCounts:Object.fromEntries(Object.entries(tables).map(([table,rows])=>[table,rows.length])),excludedTables:(inventory.results||[]).map(x=>x.name).filter(excluded),...(complete?{}:{errors}),tables};
  const key='backups/'+timestamp.replace(/[:.]/g,'-')+(complete?'':'.partial')+'.json',body=JSON.stringify(payload);
  await env.FILES.put(key,body,{httpMetadata:{contentType:'application/json'}});
  if(!complete)throw Error('Partial backup saved; table exports failed: '+Object.keys(errors).join(', '));
  await pruneOldBackups(env,timestamp);
  return {key,bytes:new TextEncoder().encode(body).length,tableCount:payload.tableCount,errors};
}
