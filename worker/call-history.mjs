// The Calls list is paginated. Reporting must read the whole selected period.
export async function handleCallHistory(request,env,user){
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 if(!user.isOwner)return reply({error:'Only administrators can view team call reporting.'},403);
 const days=Number(new URL(request.url).searchParams.get('days')??7);
 if(![0,7,30].includes(days))return reply({error:'Choose a valid reporting period.'},400);
 const since=days?new Date(Date.now()-days*86400000).toISOString():'';
 const fields='zoom_call_id,contact_id,initiated_by,created_at,updated_at,duration_seconds';
 const query=`SELECT ${fields} FROM zoom_calls WHERE org_id=?${days?' AND created_at>=?':''}`;
 const stmt=env.DB.prepare(query),args=days?[user.orgId,since]:[user.orgId];
 const result=await stmt.bind(...args).all();
 return reply({data:{days,calls:result.results||[]}});
}
