// Plain-language name of a recommended market selection (shared by fixture cards, the homepage and match pages).
export function pickLabel(o, f) {
  const home = f?.home?.name ?? 'Home', away = f?.away?.name ?? 'Away';
  if (!o) return null;
  if (o.market === 'result') return o.selection === 'draw' ? 'Draw' : `${o.selection === 'home' ? home : away} to win`;
  if (o.market === 'double-chance') return o.selection === '1X' ? `${home} or draw` : o.selection === 'X2' ? `${away} or draw` : 'Either team to win';
  if (o.market === 'btts') return o.selection === 'yes' ? 'Both teams to score' : 'Not both teams to score';
  if (o.market === 'total') return `${o.selection === 'over' ? 'Over' : 'Under'} ${o.line} goals`;
  return o.label ?? null;
}
