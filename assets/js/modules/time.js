export function nowIso() {
  return new Date().toISOString();
}

export function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

export function nowTimeStr() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function normalizeHHMM(v) {
  const raw = String(v || '').trim();
  return /^\d{2}:\d{2}$/.test(raw) ? raw : '';
}

export function normalizeTimeZone(v) {
  const tz = String(v || '').trim();
  return tz || 'UTC';
}

export function hhmmFromIsoInTimeZone(iso, timeZone) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const out = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: normalizeTimeZone(timeZone),
    }).format(d);
    return normalizeHHMM(out);
  } catch {
    return '';
  }
}

export function ymdFromIsoInTimeZone(iso, timeZone) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const out = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: normalizeTimeZone(timeZone),
    }).format(d);
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : '';
  } catch {
    return '';
  }
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtDateUtc(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

export function formatTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
