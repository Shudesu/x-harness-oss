import { takeQuota } from './rate-limit.js';
// Preserve user-approved text exactly; never obfuscate to evade duplicate checks.
export function varyTemplate(template: string, templates?: string[]): string {
  return templates?.length ? templates[Math.floor(Math.random()*templates.length)] : template;
}
export async function checkRateLimit(db:D1Database, accountId:string,maxPerHour=30):Promise<boolean> {
  return takeQuota(db,`delivery:${accountId}`,3600000,maxPerHour);
}
