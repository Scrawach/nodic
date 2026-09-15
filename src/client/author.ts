const colors = ['#4c956c', '#487fbd', '#b45f8c', '#c18a35', '#8065b1', '#3d989d'];
export function authorProfile() {
  let seed = sessionStorage.getItem('nodic-author-seed');
  if (!seed) {
    seed = crypto.randomUUID();
    sessionStorage.setItem('nodic-author-seed', seed);
  }
  const color = colors[parseInt(seed.slice(0, 4), 16) % colors.length];
  return {
    name: sessionStorage.getItem('nodic-name') || `Автор ${seed.slice(0, 4)}`,
    color,
    colorLight: color + '33',
  };
}
