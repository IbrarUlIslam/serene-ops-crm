// A calling preference selects a handoff; it never grants provider access.
export function callingProvider(db,user){
 const person=(db.users||[]).find(p=>p.auth_user_id===user.id||p.id===user.id||String(p.email||'').toLowerCase()===String(user.email||'').toLowerCase()&&!!user.email);
 const value=db.user_prefs?.[person?.id||user.id]?.dialProvider;
 const sales=!user.isOwner&&(user.roleCode==='sales_associate'||user.visibility?.profile==='sales_associate');
 return ['zoom','google_voice'].includes(value)?value:sales?'google_voice':'zoom';
}
export function phoneCountry(contact){
 const digits=String(contact.phone||'').replace(/\D/g,'');
 if(!digits)return 'Unknown';
 const declared=String(contact.phone_country_code||'').trim().toUpperCase();
 const prefixes=[['44','GB'],['353','IE'],['61','AU'],['91','IN'],['92','PK']];
 const prefix=prefixes.find(([p])=>digits.startsWith(p));
 if(prefix)return prefix[1];
 if(digits.length===10||digits.length===11&&digits.startsWith('1'))return ['US','CA'].includes(declared)?declared:'NANP';
 return /^[A-Z]{2}$/.test(declared)?declared:'Unknown';
}
