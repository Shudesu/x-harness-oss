// Read-only by default. --apply upgrades at most 100 records per column.
const base=process.env.X_HARNESS_API_URL,key=process.env.X_HARNESS_API_KEY;
if(!base||!key||new URL(base).protocol!=='https:')throw new Error('Set HTTPS X_HARNESS_API_URL and X_HARNESS_API_KEY');
const response=await fetch(`${base.replace(/\/$/,'')}/api/maintenance/secrets`,{method:process.argv.includes('--apply')?'POST':'GET',headers:{Authorization:`Bearer ${key}`},redirect:'error'});
if(!response.ok)throw new Error(`Migration request failed: ${response.status}`);
console.log(JSON.stringify(await response.json(),null,2));
