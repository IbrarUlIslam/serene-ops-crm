// Keep the existing bundled CRM intact; attach a navigation link after it renders.
(() => {
  const attach=()=>{const growth=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Contacts');if(!growth||document.getElementById('audit-connector-nav'))return;const link=document.createElement('a');link.id='audit-connector-nav';link.textContent='Audit connectors';link.href='/audit-connectors.html';link.style.cssText='display:block;padding:10px 14px;color:inherit;text-decoration:none;font:inherit';growth.insertAdjacentElement('afterend',link);};
  attach();let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;attach();});}).observe(document.body,{childList:true,subtree:true});
})();
