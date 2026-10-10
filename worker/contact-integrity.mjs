import {decodeSnapshot} from './snapshot-codec.mjs';
export const contactKeys=c=>{let p=String(c.phone||'').split(/(?:ext\.?|x|#)\s*\d+$/i)[0].replace(/\D/g,'');if(p.length===11&&p.startsWith('1'))p=p.slice(1);const e=String(c.email||'').trim().toLowerCase();return [p.length>=7?'phone:'+p:'',e.includes('@')?'email:'+e:''].filter(Boolean);};
export function enforceContactIntegrity(data,before={}){
 const old=new Map((before.contacts||[]).map(c=>[c.id,c])),keys=new Map();
 const ids=new Set();for(const c of data.contacts||[]){if(!c.id)continue;if(ids.has(c.id)){const e=Error('A contact record appears more than once. Remove the duplicate entry before saving.');e.code='DUPLICATE_CONTACT';e.status=409;throw e;}ids.add(c.id);for(const k of contactKeys(c)){if(!keys.has(k))keys.set(k,new Set());keys.get(k).add(c.id);}}
 for(const c of data.contacts||[]){const prior=old.get(c.id),changed=!prior||JSON.stringify(contactKeys(prior))!==JSON.stringify(contactKeys(c));if(changed&&contactKeys(c).some(k=>keys.get(k).size>1)){const e=Error('A contact with this phone number or email already exists. Search existing contacts or ask an administrator to assign the existing record.');e.code='DUPLICATE_CONTACT';e.status=409;throw e;}
 if(c.status==='DNC'){c.do_not_call=true;c.do_not_call_at=c.do_not_call_at||new Date().toISOString();}
 if(c.status==='Client'&&!c.owner_user_id){const users=data.users||[],owner=users.find(u=>u.name===c.owner)||users.find(u=>u.auth_user_id==='u_ibrar'||u.id==='u_ibrar')||users.find(u=>u.role==='Owner / Admin');if(owner){c.owner=owner.name;c.owner_user_id=owner.auth_user_id||owner.id;}}
 }
 return data;
}
export async function checkedSnapshot(data,previous){let value;try{value=typeof data==='string'?JSON.parse(data):data;}catch{return data;}if(value&&Array.isArray(value.contacts)){const before=previous?.data?await decodeSnapshot(previous.data):{};enforceContactIntegrity(value,before);}return value;}
