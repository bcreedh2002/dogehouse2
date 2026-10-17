// Explicit deployment configuration only. Never infer trust from request headers.
export function siteConfig(siteValue: string | undefined, originsValue?: string): {siteUrl: string; allowedOrigins: string[]} {
 if (!siteValue?.trim()) throw Error('SITE_URL is required');
 const site = new URL(siteValue.trim());
 if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash)
  throw Error('SITE_URL must be an HTTPS URL without credentials, query or fragment');
 const allowedOrigins = originsValue === undefined ? [site.origin] : originsValue.split(',').map(value => value.trim());
 for (const value of allowedOrigins) {
  const origin = new URL(value);
  if (origin.protocol !== 'https:' || origin.origin !== value || origin.username || origin.password)
   throw Error('ALLOWED_ORIGINS must contain exact HTTPS origins');
 }
 if (!allowedOrigins.includes(site.origin)) throw Error('ALLOWED_ORIGINS must include SITE_URL origin');
 return {siteUrl: site.href, allowedOrigins: [...new Set(allowedOrigins)]};
}
