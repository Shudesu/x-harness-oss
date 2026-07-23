export function resolveCorsOrigin(requestOrigin: string, configuredOrigins: string | undefined): string | null {
  if (!requestOrigin || !configuredOrigins) return null;
  const allowlist = configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (allowlist.includes('*')) return null;
  return allowlist.includes(requestOrigin) ? requestOrigin : null;
}
