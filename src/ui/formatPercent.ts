export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(2));
  return `${rounded === 0 ? 0 : rounded}%`;
}
