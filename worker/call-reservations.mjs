export const RESERVATION_MS=15*60000;
export async function acquireReservation(env,org,contact,user,now){
 const result=await env.DB.prepare('INSERT INTO call_reservations (org_id,contact_id,user_id,expires_at) VALUES (?,?,?,?) ON CONFLICT(org_id,contact_id) DO UPDATE SET user_id=excluded.user_id,expires_at=excluded.expires_at WHERE call_reservations.expires_at<=? OR call_reservations.user_id=?').bind(org,contact,user,now+RESERVATION_MS,now,user).run();
 return !!result.meta?.changes;
}
export async function reservationFor(env,org,contact,now){return env.DB.prepare('SELECT user_id,expires_at FROM call_reservations WHERE org_id=? AND contact_id=? AND expires_at>?').bind(org,contact,now).first();}
export async function releaseReservation(env,org,contact,user){await env.DB.prepare('DELETE FROM call_reservations WHERE org_id=? AND contact_id=? AND user_id=?').bind(org,contact,user).run();}
export async function applyReservations(env,queue,user,now){
 const held=(await env.DB.prepare('SELECT contact_id,user_id,expires_at FROM call_reservations WHERE org_id=? AND expires_at>?').bind(user.orgId,now).all()).results||[];
 const byId=new Map(held.map(r=>[r.contact_id,r]));
 for(const bucket of ['available','upcoming','review'])for(const row of queue[bucket]){const r=byId.get(row.contactId);if(r){row.reservedByMe=r.user_id===user.id;row.reservedUntil=new Date(r.expires_at).toISOString();if(!row.reservedByMe){row.availableNow=false;row.bucket='review';row.reasonCodes=['reserved'];row.reasons=['Another associate has reserved this contact. Wait until the reservation is released or expires.'];}}}
 const moved=queue.available.filter(r=>r.bucket==='review').concat(queue.upcoming.filter(r=>r.bucket==='review'));
 queue.available=queue.available.filter(r=>r.bucket!=='review');queue.upcoming=queue.upcoming.filter(r=>r.bucket!=='review');queue.review.push(...moved);queue.reservationsEnabled=true;
 return queue;
}
