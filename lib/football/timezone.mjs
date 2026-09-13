export function validZone(zone) {
  try { new Intl.DateTimeFormat('en',{timeZone:zone}).format(); return typeof zone==='string' && zone.length>0; } catch { return false; }
}
export function calendarDay(instant, zone) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
  const get = type => parts.find(p=>p.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function dayBounds(day, zone='UTC') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || !validZone(zone)) throw Error('Invalid date or timezone');
  // Find the first instant on each local calendar day. This also handles 23/25h DST days.
  const boundary = target => {let lo=Date.parse(target)-36*3600000,hi=Date.parse(target)+36*3600000;while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(calendarDay(mid,zone)<target)lo=mid;else hi=mid;}return hi;};
  const next=new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
  return {start:boundary(day),end:boundary(next)};
}
export function formatKickoff(fixture, zone) {
  if (!fixture?.startsAt) return 'Kickoff time to be confirmed';
  if (fixture.kickoffPrecision==='date') return `${new Date(fixture.startsAt).toISOString().slice(0,10)} · Kickoff time to be confirmed`;
  if (!zone) return 'Loading local kickoff…';
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(fixture.startsAt));
}
