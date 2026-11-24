/* VOID · shared.js: data, state, order maths, nav, footer, modal, toast. Every page loads this first.
   All sample data lives here and in console-data.js so a real API can replace it in one place. */
(() => {
const V = window.V = { DEMO: true };
const $ = V.$ = (s, r = document) => r.querySelector(s);
const $$ = V.$$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = V.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
V.money = (n) => 'LKR ' + Math.round(n).toLocaleString('en-US');
V.short = (n) => n >= 1e6 ? 'LKR ' + (n / 1e6).toFixed(2) + 'M' : V.money(n);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
V.date = (iso, long) => { const [y, m, d] = iso.split('-').map(Number); const s = `${d} ${MONTHS[m - 1]} ${y}`; return long ? `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${s}` : s; };
V.dm = (iso) => { const [, m, d] = iso.split('-').map(Number); return [d, MONTHS[m - 1]]; };

/* ---------- Data: from the API, loaded by api.js before this file runs ---------- */
const BOOT = window.BOOT || {};
V.DEMO = BOOT.demo !== false;
const iso = (d) => d.slice(0, 10);
V.events = (BOOT.events || []).map((x, i) => ({ id: x.legacyId ?? i, _id: x.id, slug: x.slug, name: x.name, date: x.date || iso(x.startsAt), venue: x.venue, city: x.city, from: x.fromPriceCents / 100, genre: x.genre, status: x.label, apiStatus: x.status, organizer: x.organizer, art: x.art, cap: x.capacity, region: x.region, model: x.hasModel, hasVip: x.hasVip }));
V.event = (id) => V.events.find((e) => e.id === +id) || V.events[0] || { id: 0, name: 'Event', date: '2027-01-01', venue: '', city: '', from: 0, genre: '', status: '', art: 'festival-stage', cap: 0 };
V.art = (e) => `assets/photos/${e.art}.webp`;
V.href = (e, page = 'event') => `${page}.html#e${e.id}`;
V.GATES = Date.parse('2027-02-27T16:00:00+05:30');

/* ---------- Store: localStorage with an in-memory fallback ---------- */
const mem = {};
V.store = {
  get(k, d) { try { const v = localStorage.getItem('void.' + k); return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch { return k in mem ? mem[k] : d; } },
  set(k, v) { mem[k] = v; try { localStorage.setItem('void.' + k, JSON.stringify(v)); } catch { /* memory only */ } },
  reset() { try { Object.keys(localStorage).filter((k) => k.startsWith('void.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } Object.keys(mem).forEach((k) => delete mem[k]); },
};
/* The page's subject (event id, tier, share link) travels in the hash and is remembered, because in-page anchors reuse the hash. */
V.ctx = () => {
  const h = location.hash.slice(1); let c = V.store.get('ctx', { e: 0 });
  const m = /^e(\d)(?:-(gold|platinum))?$/.exec(h), s = /^share-([\w-]+)-(\d)$/.exec(h);
  if (m) c = { e: +m[1], tier: m[2] || null };
  if (s) c = { ...c, share: { code: s[1], i: +s[2] } }; else if (m) delete c.share;
  V.store.set('ctx', c); return c;
};

/* ---------- Platform settings the consoles change and the fan site reads ---------- */
V.fee = () => BOOT.fee ?? 5;
V.paused = (id) => V.event(id).apiStatus === 'suspended';
V.status = (e) => e.status;
V.bookable = (e) => e.apiStatus === 'live';
V.audit = () => {};

/* ---------- Tiers, tables, order maths ---------- */
const D = BOOT.detail;
const STATE = { 'on sale': 'live', 'sold out': 'sold' };
V.tiers = (e) => (D && D.legacyId === e.id ? D.tiers : []).map((t) => ({ id: t.id, name: t.name, price: t.priceCents / 100, total: t.total, left: t.left, state: STATE[t.state] || 'next' }));
V.liveTier = (e) => V.tiers(e).find((t) => t.state === 'live');
V.VIP = { gold: { name: 'Gold', price: 100000, seats: 6, perks: ['Raised deck with a clear stage view', 'VIP entrance', 'Seats up to 6'] }, platinum: { name: 'Platinum', price: 180000, seats: 10, perks: ['Lake-side deck beside the stage', 'VIP entrance and table host', 'Seats up to 10'] } };
V.tables = () => (BOOT.tables || []).map((t) => ({ id: t.code, tier: t.tier, seats: t.seats, price: t.minSpendCents / 100, status: t.status }));
V.freeTables = (tier) => V.tables().filter((t) => t.tier === tier && t.status === 'available').length;
/* Subtotal is qty × unit (or the table's minimum spend). Fee is the platform percent, rounded to the rupee. A share is the total over the group. */
/* Same maths as the server: the lead's share carries any rounding remainder. */
V.calc = ({ qty = 1, unit, group = 1 }) => { const subtotal = qty * unit, pct = V.fee(), fee = Math.round(subtotal * pct / 100), total = subtotal + fee, base = Math.floor(total / group); return { subtotal, pct, fee, total, share: base, lead: base + (total - base * group) }; };
V.HOLD_MS = (9 * 60 + 41) * 1000;
V.SPLIT_MS = 48 * 3600 * 1000;

/* ---------- Account ---------- */
V.user = () => BOOT.user || null;
V.initials = (n) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/* ---------- Small UI parts ---------- */
V.STAR = 'M12 0C12.9 8.2 15.8 11.1 24 12 15.8 12.9 12.9 15.8 12 24 11.1 15.8 8.2 12.9 0 12 8.2 11.1 11.1 8.2 12 0Z';
V.star = (cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${V.STAR}"/></svg>`;
const ICONS = { arrow: 'M5 12h14M13 6l6 6-6 6', back: 'M19 12H5M11 6l-6 6 6 6', check: 'M5 12.5l4.5 4.5L19 7.5', close: 'M6 6l12 12M18 6L6 18', menu: 'M4 8h16M4 16h16',
  cube: 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9zM12 12l7.8-4.5M12 12L4.2 7.5M12 12v9', ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4zM14 6v12',
  play: 'M8 5.5v13l11-6.5z', pause: 'M8 5v14M16 5v14', full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' };
V.icon = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;
V.lockup = (size = 'sm') => `<span class="lockup lockup-${size}" translate="no">${V.star()}<span>VOID</span></span>`;
V.chip = (state) => `<span class="chip" data-state="${esc(state)}">${esc(state)}</span>`;
V.card = (e) => { const [d, m] = V.dm(e.date), st = V.status(e);
  return `<article class="event reveal"${st === 'Sold out' ? ' data-soldout' : ''}><div class="photo"><img src="${V.art(e)}" alt="" loading="lazy"></div>
  <p class="event-when"><b>${d}</b><span>${m}</span></p>${V.chip(st)}
  <div class="event-body"><h3 class="h-card"><a href="${V.href(e)}">${esc(e.name)}</a></h3><p class="event-place">${esc(e.venue)}, ${esc(e.city)}</p>
  <p class="event-buy"><span class="event-genre">${esc(e.genre)}</span><span class="event-price">From ${V.money(e.from)}</span></p></div></article>`; };
/* A demo QR: a fixed pattern drawn from the order code. The backend replaces it with a signed, scannable code. */
V.qrImg = (ticketId, t, q) => `<img class="qr" src="${API.BASE}/tickets/${encodeURIComponent(ticketId)}/qr.svg?${q ? `q=${encodeURIComponent(q)}` : t ? `t=${encodeURIComponent(t)}` : ''}" alt="Ticket QR" width="160" height="160" style="background:#fff;border-radius:8px">`;
V.qr = (code) => { let h = 2166136261; for (const c of code) h = Math.imul(h ^ c.charCodeAt(0), 16777619); const n = 21; let r = '';
  const finder = (x, y) => (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let on;
    if (finder(x, y)) { const fx = x > 13 ? x - 14 : x, fy = y > 13 ? y - 14 : y; on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx > 1 && fx < 5 && fy > 1 && fy < 5); }
    else { h = Math.imul(h ^ (h >>> 13), 1274126177) + x * 31 + y * 17; on = (h >>> 7) & 1; }
    if (on) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }
  return `<svg class="qr" viewBox="0 0 ${n} ${n}" role="img" aria-label="Ticket QR for ${esc(code)}" shape-rendering="crispEdges" fill="#000">${r}</svg>`; };

/* ---------- Toast and the one shared sheet ---------- */
let toastT;
V.toast = (msg) => { let t = $('#toast'); if (!t) { t = document.createElement('p'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));z-index:90;opacity:0;transform:translate(-50%,16px);transition:opacity 360ms var(--ease-out),transform 360ms var(--ease-out);pointer-events:none;margin:0'; document.body.append(t); }
  t.textContent = msg; requestAnimationFrame(() => { t.style.opacity = 1; t.style.transform = 'translate(-50%,0)'; }); clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = 0; t.style.transform = 'translate(-50%,16px)'; }, 3600); };
V.modal = ({ title, html = '', actions = [], onOpen }) => {
  let d = $('#sheet'); if (!d) { d = document.createElement('dialog'); d.id = 'sheet'; d.className = 'sheet'; document.body.append(d); d.addEventListener('close', () => { document.documentElement.style.overflow = ''; d._opener?.focus?.(); }); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
  d._opener = document.activeElement;
  d.innerHTML = `<button class="icon-btn sheet-close" aria-label="Close">${V.icon('close')}</button><div class="sheet-body"><h2>${title}</h2><div class="sheet-content">${html}</div><div class="modal-actions"></div></div>`;
  $('.sheet-close', d).onclick = () => d.close();
  const box = $('.modal-actions', d);
  actions.forEach((a) => { const b = document.createElement('button'); b.className = 'btn btn-wide ' + (a.primary ? 'btn-primary' : 'btn-line'); b.textContent = a.label; b.onclick = () => { if (a.onClick?.(d) !== false) d.close(); }; box.append(b); });
  document.documentElement.style.overflow = 'hidden';
  try { d.showModal(); } catch { d.setAttribute('open', ''); }
  onOpen?.(d); return d;
};
V.confirm = (title, body, label, fn) => V.modal({ title, html: `<p>${body}</p>`, actions: [{ label, primary: true, onClick: fn }, { label: 'Cancel' }] });
V.copy = async (text, msg = 'Copied') => { try { await navigator.clipboard.writeText(text); V.toast(msg); } catch { V.modal({ title: 'Copy this', html: `<label class="field">Select and copy<input class="control" readonly value="${esc(text)}"></label>`, actions: [{ label: 'Done', primary: true }], onOpen: (d) => $('input', d).select() }); } };

const SUPPORT = 'hello@eventsbythevoid.lk';
const INFO = {
  About: `<p>VOID, Events by the Void, puts every live night in Sri Lanka in one place. Look around the venue in 3D before you buy, book general admission or a VIP table, and split the bill with friends.</p><p>Built by team IIT ATP-CS24.</p>`,
  Contact: `<p>Email <b>${SUPPORT}</b> and we will reply within one working day.</p><p>Support hours are Monday to Friday, 9 am to 5 pm, Asia/Colombo.</p><p>For a question about one event, use Contact Organizer on that event's page.</p>`,
  Policies: `<p><b>Tickets.</b> Each ticket admits the number of people shown on it. Events are 21+ and ID is checked at the gate.</p><p><b>Transfers.</b> You can transfer a ticket to a named person from My Tickets up to gate time.</p><p><b>Refunds.</b> Refund requests go to the organizer. If an event is cancelled you are refunded in full to the way you paid.</p><p><b>Split pay.</b> A group has 48 hours to finish paying. If it does not, the reservation is released and paid shares are refunded.</p>`,
  'Privacy Notice': `<p>We collect only what each step needs: your email for lists, and your name, mobile and order details for bookings.</p><p>Marketing is opt-in and every message has an unsubscribe link. You can ask to see, export or delete your data at any time by emailing ${SUPPORT}.</p><p>Card details are entered with our payment partners and never stored by VOID.</p>`,
  FAQ: `<p><b>How do I get my ticket?</b> It appears in My Tickets as a QR pass the moment you pay, and we email it too.</p><p><b>What is a party pass?</b> One group QR that admits the whole party together.</p><p><b>What is Koko?</b> Pay a third today and the rest in two monthly payments, interest free.</p><p><b>Can I see the venue first?</b> Yes. Open The Venue on any event with a 3D model and fly or walk through it.</p>`,
  Terms: `<p>By booking you agree to the event's entry rules, the 21+ age limit and the Refund policy. Tickets resold above face value may be cancelled.</p><p>A seat hold lasts 10 minutes. Prices include the booking fee shown at checkout.</p>`,
  'Refund policy': `<p>You can request a refund from My Tickets. The organizer decides under the event's terms, and approved refunds return to the original payment method. Refunded tickets stop working at the gate.</p><p>If an event is cancelled or moved, every ticket holder is refunded in full.</p>`,
};
V.info = (name) => V.modal({ title: esc(name), html: INFO[name] || '', actions: [{ label: 'Close', primary: true }] });

/* ---------- Forms shared by several pages ---------- */
V.notify = (e, kind = 'Notify Me') => V.modal({ title: `${esc(kind)}`, html: `<p>We will email you once about <b>${esc(e.name)}</b>, then stop.</p><form class="stack" id="nf" style="margin-top:14px"><label class="field">Email<input class="control" type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label><label class="check"><input type="checkbox" required>Yes, email me about this event</label><button class="btn btn-primary btn-wide">${esc(kind)}</button></form>`,
  onOpen: (d) => { $('#nf', d).onsubmit = async (ev) => { ev.preventDefault(); const email = new FormData(ev.target).get('email');
    try { await API.post(`/events/${e.slug}/notify`, { email, consent: true }); const n = V.store.get('notify', {}); n[e.id] = true; V.store.set('notify', n); d.close(); V.toast("You're on the list."); document.dispatchEvent(new CustomEvent('void:notify')); } catch (err) { V.toast(err.message); } }; } });
V.newsletter = (form) => { form.addEventListener('submit', async (ev) => { ev.preventDefault(); const email = form.querySelector('[type=email]').value;
  try { await API.post('/newsletter', { email, consent: true }); } catch (err) { return V.toast(err.message); } form.innerHTML = `<p class="done-line" role="status">${V.icon('check')} You're in. See you out there.</p>`; }); };

/* ---------- Nav and footer ---------- */
const CREDITS = 'Night View of Colombo City Skyline by Thilina Alagiyawanna (CC0); DJ at an Electronic Music Festival by Lucas Gallone (CC0); Viharamahadevi Park, Colombo by Alexey Komarov (CC BY 3.0); Mirissa beach by dronepicr (CC BY 2.0); Musicians performing at a night concert by Shixart1985 (CC BY 2.0); Kandy lake by Vyacheslav Argenberg (CC BY 4.0); Pattaya Music Festival by Vyacheslav Argenberg (CC BY 4.0); Galle Fort and lighthouse by calflier001 (CC BY-SA 2.0). All from Wikimedia Commons.';
V.chrome = (page) => {
  const u = V.user(), cur = (p) => page === p ? ' aria-current="page"' : '';
  const skip = document.createElement('a'); skip.className = 'skip'; skip.href = '#main'; skip.textContent = 'Skip to main content'; document.body.prepend(skip);
  $('#nav').outerHTML = `<header class="nav" id="nav"><a href="index.html" class="lockup lockup-sm" aria-label="VOID home" translate="no">${V.star()}<span>VOID</span></a>
    <nav class="nav-links" id="navLinks" aria-label="Main"><a href="index.html#events"${cur('events')}>Events</a><a href="venues.html"${cur('venues')}>Venues</a><a href="tickets.html"${cur('tickets')}>My Tickets</a></nav>
    <div class="nav-actions"><a class="${u ? 'nav-user' : 'btn btn-ghost btn-sm'}" href="auth.html">${u ? esc(u.name.split(' ')[0]) : 'Sign In'}</a><a class="btn btn-primary btn-sm" href="event.html#e0">Get Tickets</a>
    <button class="icon-btn nav-toggle" id="navToggle" aria-label="Menu" aria-expanded="false" aria-controls="navLinks">${V.icon('menu')}</button></div></header>`;
  const nav = $('#nav'), tg = $('#navToggle');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 24); addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const close = (focus) => { nav.classList.remove('open'); tg.setAttribute('aria-expanded', 'false'); if (focus) tg.focus(); };
  tg.onclick = () => { const o = nav.classList.toggle('open'); tg.setAttribute('aria-expanded', o); };
  $('#navLinks').addEventListener('click', (e) => e.target.closest('a') && close());
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) close(true); });
  const f = $('#footer'); if (f) { f.outerHTML = `<footer class="footer"><div class="wrap"><div class="footer-cols">
    <nav aria-label="Explore"><strong>Explore</strong><a href="index.html#events">Events</a><a href="venues.html">Venues</a><a href="tickets.html">My Tickets</a><a href="index.html#team">Our Team</a><a href="admin.html">For Organizers</a></nav>
    <nav aria-label="Help"><strong>Need a Hand</strong>${['Contact', 'Policies', 'Privacy Notice', 'FAQ'].map((n) => `<button class="fl" data-info="${n}">${n}</button>`).join('')}</nav>
    <div><strong>Stay in the Loop</strong><form class="footer-mail" id="footMail"><label class="sr-only" for="fm">Email address</label><input class="control" id="fm" type="email" required placeholder="Your email address" autocomplete="email"><button class="icon-btn" aria-label="Sign up">${V.icon('arrow')}</button></form>
      <a href="mailto:${SUPPORT}">${SUPPORT}</a><div class="social">${['IG', 'FB', 'TT', 'in'].map((s) => `<a href="#" aria-label="VOID on ${s}" data-noop>${s}</a>`).join('')}</div></div></div>
    <div class="footer-bottom"><span>© 2027 VOID</span>${V.DEMO ? '<span>All transactions are simulated</span>' : ''}<details class="credits"><summary>Photo credits</summary><p>${CREDITS}</p></details></div></div>
    <p class="footer-word" aria-hidden="true"><img src="assets/the-void.png" alt="" width="1916" height="164" loading="lazy"></p></footer>`;
    V.newsletter($('#footMail')); }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-noop]')) e.preventDefault(); const b = e.target.closest('[data-info]'); if (b) V.info(b.dataset.info); });
  /* Sections rise and fade in as they scroll into view. */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((en) => en.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px' }) : null;
  V.reveal = (root = document) => $$('.reveal:not(.in)', root).forEach((el) => io ? io.observe(el) : el.classList.add('in'));
  V.reveal();
};
V.fmtLeft = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min`; return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
})();
