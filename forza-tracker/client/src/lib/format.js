export function formatLap(ms) {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

export function parseLap(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : 0;
  const seconds = Number(m[2]);
  const millis = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
  return minutes * 60000 + seconds * 1000 + millis;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
