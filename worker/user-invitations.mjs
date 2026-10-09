const origin='https://crm.sereneop.com';
const norm=x=>String(x||'').trim().toLowerCase();
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now=()=>new Date().toISOString();
export function invitationEmail(user){return {toAddress:user.email,subject:'Your Serene Ops CRM access',content:`<div style="background:#fdf6e3;color:#4c484f;padding:32px;font-family:Arial,sans-serif;line-height:1.6"><h2>Welcome to Serene Ops</h2><p>Hi ${escape(user.name)},</p><p>Your CRM access is ready.</p><p><a href="${origin}" style="color:#007da3">Open your workspace</a></p><p>Sign in using <strong>${escape(user.email)}</strong>. Follow the sign-in method shown on the page. If you choose email sign-in, enter the verification code sent to your inbox.</p><p>Your workspace uses the access approved for your role by your CRM administrator. Contact Ibrar if you need a change to your access.</p><p>Serene Ops</p></div>`};}
export function invitationConfigured(env){return !!(env.CRM_ACCESS_API_TOKEN&&env.CRM_ACCESS_ACCOUNT_ID&&env.CRM_ACCESS_POLICY_ID);}
export function policyWithEmail(policy,email,enabled){
 if(policy.name!=='Serene Ops CRM invitations'||policy.decision!=='allow'||!Array.isArray(policy.include)||policy.include.some(r=>Object.keys(r).some(k=>k!=='email'))||policy.include.some(r=>!r.email?.email))throw Error('The approved-users policy needs review before invitations can run.');
 const copy={};for(const key of ['name','decision','include','exclude','require','approval_groups','approval_required','purpose_justification_prompt','purpose_justification_required','session_duration','isolation_required','mfa_config','connection_rules'])if(Object.hasOwn(policy,key))copy[key]=structuredClone(policy[key]);
 copy.include=copy.include.filter(r=>norm(r.email.email)!==norm(email));if(enabled)copy.include.push({email:{email:norm(email)}});if(!copy.include.length)throw Error('The sign-in allowlist cannot be empty.');return copy;
}
async function cf(env,method,body,fetcher){const url=`https://api.cloudflare.com/client/v4/accounts/${env.CRM_ACCESS_ACCOUNT_ID}/access/policies/${env.CRM_ACCESS_POLICY_ID}`;const r=await fetcher(url,{method,headers:{Authorization:`Bearer ${env.CRM_ACCESS_API_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok||!data.success||!data.result)throw Error('Cloudflare sign-in approval failed. Check the invitation connection.');return data.result;}
export async function syncAccessEmail(env,email,enabled,fetcher=fetch){
 if(!invitationConfigured(env))throw Error('The invitation connection is not set up yet.');
 const current=await cf(env,'GET',null,fetcher),desired=policyWithEmail(current,email,enabled);
 const already=current.include.some(r=>norm(r.email.email)===norm(email));if(already===enabled)return;
 await cf(env,'PUT',desired,fetcher);const check=await cf(env,'GET',null,fetcher);policyWithEmail(check,email,enabled);
 if(check.include.some(r=>norm(r.email.email)===norm(email))!==enabled)throw Error('Cloudflare did not confirm the sign-in change.');
}
async function lock(env,org){const lease=crypto.randomUUID(),ms=Date.now();await env.DB.prepare('INSERT INTO user_invitation_locks(org_id,lease_id,expires_at) VALUES(?,?,?) ON CONFLICT(org_id) DO UPDATE SET lease_id=excluded.lease_id,expires_at=excluded.expires_at WHERE user_invitation_locks.expires_at < ?').bind(org,lease,ms+180000,ms).run();const row=await env.DB.prepare('SELECT lease_id FROM user_invitation_locks WHERE org_id=?').bind(org).first();if(row?.lease_id!==lease)throw Error('Another invitation is processing. Try again shortly.');return lease;}
async function release(env,org,lease){await env.DB.prepare('DELETE FROM user_invitation_locks WHERE org_id=? AND lease_id=?').bind(org,lease).run();}
async function state(env,org,id,status,accessStatus,sentAt=null,attemptedAt=null){await env.DB.prepare('INSERT INTO user_invitations(org_id,user_id,status,access_status,sent_at,attempted_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET status=excluded.status,access_status=excluded.access_status,sent_at=COALESCE(excluded.sent_at,user_invitations.sent_at),attempted_at=COALESCE(excluded.attempted_at,user_invitations.attempted_at),updated_at=excluded.updated_at').bind(org,id,status,accessStatus,sentAt,attemptedAt,now()).run();}
export async function inviteUser(env,actor,id,options={},services={}){
 if(!actor.isOwner)throw Error('Only CRM administrators can invite users.');
 const user=await env.DB.prepare('SELECT id,name,email,status FROM users WHERE id=? AND org_id=? AND deleted_at IS NULL').bind(id,actor.orgId).first();if(!user||user.status!=='active')throw Error('Only active CRM users can be invited.');if(user.id===actor.id&&!options.test)throw Error('Your account already has CRM administrator access.');
 if(!invitationConfigured(env))return {ok:false,id,accessNotice:'Account saved. Finish the invitation connection before sending login instructions.'};
 const lease=await lock(env,actor.orgId);let access='pending',sending=false;
 try{
  const existing=await env.DB.prepare('SELECT * FROM user_invitations WHERE org_id=? AND user_id=?').bind(actor.orgId,id).first();
  if(existing?.status==='sent'&&!options.resend)return {ok:true,id,accessNotice:'The invitation was already sent.',invitationStatus:'sent'};
  if(['sending','send_unknown'].includes(existing?.status)&&!options.resend)return {ok:false,id,accessNotice:'Email delivery is unconfirmed. Check Sent mail before choosing Resend invitation.',invitationStatus:'send_unknown'};
  if(existing?.attempted_at&&Date.now()-Date.parse(existing.attempted_at)<60000)return {ok:false,id,accessNotice:'Please wait one minute before another email attempt.'};
  await state(env,actor.orgId,id,'pending',access);
  await syncAccessEmail(env,user.email,true,services.fetch||fetch);access='approved';await state(env,actor.orgId,id,'access_ready',access);
  const active=await env.DB.prepare('SELECT status FROM users WHERE id=? AND org_id=?').bind(id,actor.orgId).first();if(active?.status!=='active')throw Error('The account was disabled before the invitation could be sent.');
  if(!services.sendMail)throw Error('The invitation mailbox is not connected.');
  await state(env,actor.orgId,id,'sending',access,null,now());sending=true;
  await services.sendMail(actor,invitationEmail(user));
  await state(env,actor.orgId,id,'sent',access,now());return {ok:true,id,invitationStatus:'sent',accessNotice:`Sign-in approved. Login instructions sent to ${user.email}.`};
 }catch(error){const status=sending?'send_unknown':'failed';await state(env,actor.orgId,id,status,access);return {ok:false,id,invitationStatus:status,accessNotice:sending?'Sign-in approved, but email delivery is unconfirmed. Check Sent mail before resending.':access==='approved'?'Sign-in approved, but the invitation email could not be prepared. Retry the invitation.':String(error.message)};
 }finally{await release(env,actor.orgId,lease);}
}
export async function revokeUserAccess(env,actor,user,services={}){if(!invitationConfigured(env))return 'Account disabled in the CRM. Sign-in synchronization is not configured.';let lease;try{lease=await lock(env,actor.orgId);await syncAccessEmail(env,user.email,false,services.fetch||fetch);await state(env,actor.orgId,user.id,'disabled','removed');return 'Account disabled and removed from the managed invitation policy.';}catch{return 'Account disabled in the CRM. Sign-in removal needs retry; the account cannot access CRM data.';}finally{if(lease)await release(env,actor.orgId,lease);}}
