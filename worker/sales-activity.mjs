// Counts recorded work, never a dialer launch. Stable event IDs prevent retries
// and duplicate ingestion from inflating the daily contact totals.
export function salesActivityEvents(before,after,actor,stamp,org){
 if(String(actor||'').startsWith('system:'))return [];
 const events=[],users=after.users||[],norm=v=>String(v||'').trim().toLowerCase();
 const identity=v=>{const matches=users.filter(u=>[u.id,u.auth_user_id,u.name,u.email].some(x=>x&&norm(x)===norm(v)));return matches.length===1?(matches[0].auth_user_id||matches[0].id):null;};
 const add=(kind,id,contact,who,at)=>{const userId=identity(who)||(!String(who||'').startsWith('system:')&&who===actor?actor:null);if(!userId||!contact||!Number.isFinite(Date.parse(at)))return;events.push({id:[org,userId,kind,id].join(':'),org_id:org,user_id:userId,contact_id:contact,kind,occurred_at:at});};
 for(const [key,kind] of [['calls','call'],['notes','note'],['activity','update']]){const old=new Set((before[key]||[]).map(x=>x.id));for(const row of after[key]||[]){if(!row.id||old.has(row.id))continue;if(key==='activity'&&!['sales','archive'].includes(row.kind))continue;const cid=key==='notes'?row.entity_type==='contact'?row.entity_id:null:row.contact_id;add(kind,row.id,cid,row.by_user_id||row.who||row.by,row.at);}}
 const human=actor&&!String(actor).startsWith('system:'),oldContacts=new Map((before.contacts||[]).map(c=>[c.id,c]));
 if(human)for(const row of after.contacts||[]){const old=oldContacts.get(row.id);if(!old)continue;const fields=['sales_notes','notes','status','phone','email','brokerage','transactions_per_year'];if(!events.some(e=>e.contact_id===row.id&&e.kind==='update')&&fields.some(k=>JSON.stringify(row[k]??null)!==JSON.stringify(old[k]??null)))add('update',stamp+':'+row.id,row.id,actor,stamp);}
 return events;
}
let warned=false;
export async function persistSalesActivity(env,org,before,after,actor,stamp){
 const events=salesActivityEvents(before,after,actor,stamp,org);if(!events.length)return;
 try{for(const event of events)await env.DB.prepare('INSERT OR IGNORE INTO sales_contact_activity(id,org_id,user_id,contact_id,kind,occurred_at) VALUES(?,?,?,?,?,?)').bind(event.id,event.org_id,event.user_id,event.contact_id,event.kind,event.occurred_at).run();}
 catch(error){if(!warned){console.warn('Sales activity ledger needs attention; saved workspace activity remains available.');warned=true;}}
}
