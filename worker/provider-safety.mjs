export function diagnosticMailOrigin(configured,override) {
  const trusted=new URL(configured);
  if(trusted.protocol!=='https:'||trusted.username||trusted.password)throw Error('Invalid configured Zoho mail origin.');
  if(override){const selected=new URL(override);if(selected.origin!==trusted.origin||selected.username||selected.password||selected.pathname!=='/'||selected.search||selected.hash)throw Error('Diagnostic host must match the connected Zoho mail server.');}
  return trusted.origin;
}
