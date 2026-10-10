const ZOHO_ACCOUNTS_HOSTS=new Set(['accounts.zoho.com','accounts.zoho.eu','accounts.zoho.in','accounts.zoho.com.au','accounts.zoho.com.cn','accounts.zoho.jp','accounts.zohocloud.ca','accounts.zoho.sa','accounts.zoho.ae']);
export function zohoAccountsOrigin(value='https://accounts.zoho.com') {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||!ZOHO_ACCOUNTS_HOSTS.has(u.hostname))throw Error('Unsupported Zoho accounts server.');
  return u.origin;
}
export function diagnosticMailOrigin(configured,override) {
  const trusted=new URL(configured);
  const accountHost=trusted.hostname.replace(/^mail\./,'accounts.');
  if(trusted.protocol!=='https:'||trusted.username||trusted.password||trusted.port||trusted.pathname!=='/'||trusted.search||trusted.hash||!ZOHO_ACCOUNTS_HOSTS.has(accountHost))throw Error('Invalid configured Zoho mail origin.');
  if(override){const selected=new URL(override);if(selected.origin!==trusted.origin||selected.username||selected.password||selected.pathname!=='/'||selected.search||selected.hash)throw Error('Diagnostic host must match the connected Zoho mail server.');}
  return trusted.origin;
}
