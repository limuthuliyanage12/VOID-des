/* VOID · api.js: the one place the site talks to the backend.
   Every page loads this first. API.start() fetches what the page needs, puts it on window.BOOT,
   then runs the page's own scripts in order, so they can keep rendering synchronously.
   The access token lives in memory only; the httpOnly refresh cookie gets a fresh one on each page load. */
(() => {
const BASE = (document.querySelector('meta[name="void-api"]')?.content || '').replace(/\/$/, '') + '/api/v1';
let token = null, user = null;

class ApiError extends Error { constructor(status, body) { super(body?.message || `Request failed (${status})`); this.status = status; this.code = body?.code; this.details = body?.details; } }

const request = async (method, path, body, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  const res = await fetch(BASE + path, { method, headers, credentials: 'include', body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  if (res.status === 401 && token && !opts.retried && !path.startsWith('/auth/')) { if (await refresh()) return request(method, path, body, { ...opts, retried: true }); }
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof data === 'object' ? data : { message: data });
  return data;
};

const refresh = async () => {
  try { const r = await request('POST', '/auth/refresh', undefined, { retried: true }); token = r.accessToken; user = r.user; return true; }
  catch { token = null; user = null; return false; }
};

const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));

/* Orders a guest placed on this device, so confirmation, group status and My Tickets can find them again. */
const mine = {
  all: () => { try { return JSON.parse(localStorage.getItem('void.mine') || '[]'); } catch { return []; } },
  add: (code, t) => { const list = mine.all().filter((o) => o.code !== code); list.unshift({ code, t }); try { localStorage.setItem('void.mine', JSON.stringify(list.slice(0, 30))); localStorage.setItem('void.lastOrder', code); } catch { /* private mode */ } },
  token: (code) => mine.all().find((o) => o.code === code)?.t || null,
  last: () => { try { return localStorage.getItem('void.lastOrder'); } catch { return null; } },
};

const API = window.API = {
  BASE, ApiError, key, mine,
  get: (p, o) => request('GET', p, undefined, o), post: (p, b, o) => request('POST', p, b ?? {}, o), put: (p, b, o) => request('PUT', p, b, o),
  patch: (p, b, o) => request('PATCH', p, b, o), del: (p, o) => request('DELETE', p, undefined, o),
  user: () => user, token: () => token,
  async login(body) { const r = await request('POST', '/auth/login', body); token = r.accessToken; user = r.user; return r; },
  async signup(body) { const r = await request('POST', '/auth/signup', body); token = r.accessToken; user = r.user; return r; },
  async logout() { await request('POST', '/auth/logout').catch(() => null); token = null; user = null; },
  /** A file the API serves that needs the signed-in token (CSV exports). */
  async text(p) { return request('GET', p); },

  /** Pay through PayHere. In demo mode a signed callback goes through the real webhook instead of a card form. */
  async pay(payment, demo) {
    if (payment.provider === 'koko') { location.href = payment.redirectUrl; return 'redirect'; }
    if (demo && BOOT.demo) { await API.post('/dev/payhere/complete', { orderId: demo.providerOrderId }); return 'paid'; }
    const f = document.createElement('form'); f.method = 'POST'; f.action = payment.action; f.hidden = true;
    for (const [k, v] of Object.entries(payment.fields)) { const i = document.createElement('input'); i.name = k; i.value = v; f.append(i); }
    document.body.append(f); f.submit(); return 'redirect';
  },

  async start(page, scripts) {
    const B = window.BOOT = { page, demo: true };
    try {
      await refresh();
      B.user = user;
      const loader = LOAD[page];
      if (loader) await loader(B);
    } catch (e) { B.error = e; console.error(e); }
    for (const src of scripts) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = ok; s.onerror = no; document.body.append(s); });
  },
};

/* ---------- What each page needs before its scripts run ---------- */
const ctxEvent = () => { const m = /^#e(\d+)/.exec(location.hash); if (m) return +m[1]; try { return JSON.parse(localStorage.getItem('void.ctx') || '{}').e ?? 0; } catch { return 0; } };
const events = async (B) => { const r = await API.get('/events?limit=50'); B.events = r.items; };
const LOAD = {
  home: events,
  async event(B) {
    const split = new URLSearchParams(location.search).get('split');
    await events(B);
    if (split) { B.share = await API.get(`/split/${encodeURIComponent(split)}`).catch((e) => ({ error: e })); B.shareToken = split; if (B.share.event) location.hash = `e${B.share.event.legacyId}`; }
    const ev = B.events.find((e) => e.legacyId === ctxEvent()) || B.events[0];
    B.detail = await API.get(`/events/${ev.slug}`);
    if (B.detail.hasVip) B.tables = (await API.get(`/events/${ev.slug}/tables`)).tables;
    B.fee = B.detail.bookingFeePercent;
  },
  async tables(B) { await LOAD.event(B); },
  async venue(B) { await events(B); },
  async venues(B) { await events(B); B.venues = (await API.get('/venues')).items; },
  auth: events, confirmation: events, tickets: events,
  async admin(B) { await events(B); },
  async super(B) { await events(B); },
};
})();
