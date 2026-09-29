const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

let toastTimer;
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function fmtDate(d) {
  if (!d) return '—';
  const s = String(d);
  return new Date(s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') || s.includes('T') ? '' : 'Z')).toLocaleString();
}

function fmtDur(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function can(state, perm) {
  if (!state.perms) return false;
  if (state.perms.includes('*')) return true;
  return state.perms.includes(perm);
}

export { api, toast, esc, fmtDate, fmtDur, can };
