export const prerender = true;

import { buildLlms } from '../lib/llms.mjs';

export function GET({ site }) {
  return buildLlms(site, { full: true });
}
