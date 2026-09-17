export const publicViews = new Set(['media','matchday','shortlists','markets','prediction-history','overview','catalog','fixtures','news','search','global-search','match','match-context','analysis','entity','article','competition','badges','insights']);
export function internalAccess(request, token) {
  if (typeof token !== 'string' || token.length < 32) return false;
  const supplied = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${token}`;
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
export function sameOrigin(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  try {
    const target = new URL(request.url), origin = new URL(request.headers.get('origin'));
    if (origin.origin === target.origin) return true;
    return ['http:','https:'].includes(target.protocol) && origin.protocol === 'https:' && origin.host === (request.headers.get('x-forwarded-host')??target.host);
  } catch { return false; }
}
