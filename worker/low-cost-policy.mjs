export const lowCostMode=env=>env.CRM_LOW_COST_MODE==='true';
export async function reserveAnalysis(env,at=Date.now()){
 if(!lowCostMode(env))return true;
 const day=new Date(at).toISOString().slice(0,10);
 // Shared across this CRM database, not a separate allowance for each user.
 // Failed/uncertain requests retain their slot so retries cannot overspend.
 const result=await env.DB.prepare("INSERT INTO crm_daily_usage (day,kind,used) VALUES (?,'audit_analysis',1) ON CONFLICT(day,kind) DO UPDATE SET used=used+1 WHERE used<2").bind(day).run();
 return !!result.meta?.changes;
}
export function boundedPublicInput(system,sources){
 const text=JSON.stringify({sources});
 const bytes=new TextEncoder().encode(text);
 return new TextDecoder().decode(bytes.subarray(0,20000));
}
