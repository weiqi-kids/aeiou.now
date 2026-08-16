// Small, optional GA4 bridge. The site remains fully usable when GA4 is disabled,
// blocked by a browser, or not configured for a local build.
const MAX_STRING_LENGTH = 100;

function cleanParams(params) {
  return Object.fromEntries(
    Object.entries(params || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value.slice(0, MAX_STRING_LENGTH) : value,
      ])
  );
}

export function track(name, params = {}) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, cleanParams(params));
}
