/* VOID · account.js: sign in, confirmation and My Tickets, on the API. */
(() => {
const { $, $$, esc, money } = V, page = document.body.dataset.page, main = $('#main');
V.chrome(page === 'tickets' ? 'tickets' : '');
const evOf = (id) => V.events.find((x) => x._id === id) || V.event(0);
const statusPill = (s) => s === 'valid' || s === 'paid' ? 'pill-ok">Confirmed' : s === 'used' ? 'pill-idle">Used' : s === 'split pending' ? 'pill-warn">Split pay. Awaiting friends' : s === 'void' || s === 'refunded' ? 'pill-bad">Refunded' : s === 'transferred' ? 'pill-idle">Transferred' : `pill-warn">${esc(s)}`;

/* One boarding-pass ticket. `t` is a ticket from the API; `o` the order it belongs to (for amount and payment). */
const pass = (t, o, tok) => { const e = evOf(t.event.id);
  return `<article class="pass"><div class="pass-main"><div class="row" style="justify-content:space-between">${V.lockup('sm')}<span class="pill ${statusPill(t.status)}</span></div>
    <h2 class="h-card" style="font-size:28px">${esc(t.event.name)}</h2>
    <dl><div><dt>Venue</dt><dd>${esc(t.event.venue)}, ${esc(t.event.city)}</dd></div><div><dt>Date</dt><dd>${V.date(e.date)}</dd></div><div><dt>Gates</dt><dd>4 pm</dd></div>
      <div><dt>Ticket</dt><dd>${esc(t.line)}</dd></div><div><dt>Guest</dt><dd>${esc(t.holderName)}</dd></div><div><dt>Order</dt><dd>${t.orderCode}</dd></div>
      ${o ? `<div><dt>Paid</dt><dd>${money(o.totalCents / 100)}</dd></div>` : ''}<div><dt>Admits</dt><dd>${t.admits}</dd></div>${o ? `<div><dt>Paid with</dt><dd>${{ card: 'Card', koko: 'Koko', split: 'Card · Split', comp: 'Comp', cash: 'Box office' }[o.payMethod] || o.payMethod}</dd></div>` : ''}</dl></div>
    <div class="pass-qr">${t.status === 'valid' ? V.qrImg(t.id, tok, t.qr) : '<p class="note" style="padding:24px">This QR no longer works at the gate.</p>'}<span class="note">${t.admits > 1 ? 'Party pass' : 'Single entry'}</span></div></article>`; };
const pdfHref = (t, tok) => `${API.BASE}/tickets/${t.id}/pdf?${t.qr ? `q=${encodeURIComponent(t.qr)}` : tok ? `t=${encodeURIComponent(tok)}` : ''}`;
const wallet = () => V.modal({ title: 'Add to Wallet', html: '<p>Apple and Google Wallet passes arrive once VOID has its developer accounts. Download the PDF ticket for now, or show the QR from My Tickets.</p>', actions: [{ label: 'Got It', primary: true }] });

if (page === 'auth') {
  let mode = 'in', needOtp = false; const next = location.hash === '#next-event';
  const draw = () => { const u = V.user();
    main.innerHTML = `<img class="auth-bg" src="assets/photos/live-band.webp" alt=""><section class="auth"><div><p class="eyebrow">6.9271° N, 79.8612° E · Colombo</p><h1 class="h-hero" style="margin-top:16px">Great nights. <em>Better together.</em></h1><p class="sub" style="margin-top:18px">Every ticket, table and split in one place.</p></div>
    <div class="card">${u ? `<p class="eyebrow">Signed in</p><h2 class="h-card" style="font-size:30px">You're in, ${esc(u.name.split(' ')[0])}</h2><p class="small muted">${esc(u.email)}</p>${u.role === 'organizer' || u.role === 'gate' ? '<a class="btn btn-primary btn-wide" href="admin.html">Open the Organizer Console</a>' : u.role === 'super' ? '<a class="btn btn-primary btn-wide" href="super.html">Open the Platform Console</a>' : '<a class="btn btn-primary btn-wide" href="tickets.html">View My Tickets</a>'}<button class="btn btn-line btn-wide" id="out">Sign Out</button>`
      : `<div class="toggle" role="group" aria-label="Account" style="--at:${mode === 'in' ? 0 : 1};grid-auto-columns:1fr"><span class="toggle-thumb" aria-hidden="true" style="width:calc(50% - 4px);transform:translateX(calc(var(--at) * 100%))"></span><button type="button" data-m="in" aria-pressed="${mode === 'in'}">Sign In</button><button type="button" data-m="up" aria-pressed="${mode === 'up'}">Sign Up</button></div>
      <form class="stack" id="af">${mode === 'up' ? '<label class="field">Name<input class="control" name="name" required autocomplete="name"></label>' : ''}
        <label class="field">Email<input class="control" name="email" type="email" required autocomplete="email"></label>
        <label class="field">Password<span class="pw"><input class="control" name="pw" type="password" required minlength="6" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"><button type="button" id="show" aria-pressed="false">Show</button></span></label>
        ${needOtp ? '<label class="field">Authenticator code<input class="control" name="otp" inputmode="numeric" pattern="[0-9]{6}" required autocomplete="one-time-code"></label>' : ''}
        ${mode === 'up' ? '<label class="check"><input type="checkbox" name="mkt">Email me about new events. You can unsubscribe at any time.</label>' : ''}
        <button class="btn btn-primary btn-wide">${mode === 'in' ? 'Sign In' : 'Create Account'}</button><p class="note" id="aerr" role="alert"></p></form>
      <p class="or">or</p><button class="btn btn-line btn-wide" id="google">Continue with Google</button><button class="btn btn-ghost btn-wide" id="guest">Continue as Guest</button>`}</div></section>`;
    const done = () => { if (next) { V.store.set('scrollTo', { id: 'checkout' }); location.href = `event.html#e${V.ctx().e}`; } else location.reload(); };
    $('#out') && ($('#out').onclick = async () => { await API.logout(); location.reload(); });
    $$('[data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; needOtp = false; draw(); });
    $('#show') && ($('#show').onclick = (ev) => { const i = $('[name=pw]'), on = i.type === 'password'; i.type = on ? 'text' : 'password'; ev.target.textContent = on ? 'Hide' : 'Show'; ev.target.setAttribute('aria-pressed', on); });
    $('#af') && ($('#af').onsubmit = async (ev) => { ev.preventDefault(); const f = new FormData(ev.target), email = f.get('email'), password = f.get('pw');
      try {
        if (mode === 'up') await API.signup({ name: f.get('name'), email, password, marketingConsent: !!f.get('mkt') });
        else await API.login({ email, password, ...(f.get('otp') ? { otp: f.get('otp') } : {}) });
        done();
      } catch (err) {
        if (err.code === 'MFA_CODE_REQUIRED') { needOtp = true; draw(); $('[name=email]').value = email; $('[name=pw]').value = password; $('[name=otp]').focus(); return; }
        $('#aerr').textContent = err.message;
      } });
    $('#google') && ($('#google').onclick = async () => { try { const r = await API.get('/auth/google/start'); location.href = r.url; } catch (err) { V.toast(err.status === 501 ? 'Google sign-in is not set up on this server yet.' : err.message); } });
    $('#guest') && ($('#guest').onclick = () => { location.href = next ? `event.html#e${V.ctx().e}` : 'index.html#events'; }); };
  draw();
}

if (page === 'confirmation') {
  const q = new URLSearchParams(location.search), code = q.get('order') || API.mine.last(), tok = q.get('t') || (code && API.mine.token(code));
  if (code && q.get('t')) API.mine.add(code, q.get('t'));
  const empty = (msg) => { main.innerHTML = `<section class="confirm"><p class="eyebrow">Nothing here yet</p><h1 class="h-section" style="margin:14px 0">No order <em>to show</em></h1><p class="sub" style="margin:0 auto 24px">${msg || 'Book a ticket and your pass appears here.'}</p><a class="btn btn-primary" href="index.html#events">Find Events</a></section>`; };
  if (!code) empty();
  else API.get(`/orders/${code}${tok ? `?t=${encodeURIComponent(tok)}` : ''}`).then((o) => {
    const t = o.tickets[0], split = !!o.split, waiting = split && o.status !== 'paid';
    main.innerHTML = `<section class="confirm"><div class="okmark">${V.icon('check')}</div><p class="eyebrow">${o.status === 'pending' ? 'Waiting for the payment to confirm' : "You're on the list"}</p><h1 class="h-section" style="margin-top:14px">${waiting ? 'Your share <em>is paid.</em>' : 'See you <em>out of the dark.</em>'}</h1>
      ${o.tickets.map((x) => pass(x, o, tok)).join('') || `<p class="sub" style="margin:20px auto">${o.status === 'pending' ? 'Your tickets appear here the moment the payment is confirmed. Refresh in a moment.' : 'Your tickets are issued once every share in the group is paid.'}</p>`}
      <div class="row" style="justify-content:center">${t ? `<a class="btn btn-primary" href="${pdfHref(t, tok)}">Download PDF</a><button class="btn btn-line" id="wallet">Add to Wallet</button>` : ''}<a class="btn btn-line" href="tickets.html">View My Tickets</a>${split ? `<a class="btn btn-line" href="event.html#e${evOf(o.event.id).id}" id="grp">Group Payment Status</a>` : ''}</div>
      <p class="note" style="margin-top:20px">${o.admits > 1 && o.tickets.length === 1 ? `This is a party pass. One group QR admits all ${o.admits} of you together, so arrive as a group.` : 'Show this QR at the ticket check. Gates open at 4 pm, Asia/Colombo.'}</p></section>`;
    $('#wallet') && ($('#wallet').onclick = wallet);
    $('#grp') && ($('#grp').onclick = () => { V.store.set('scrollTo', { id: 'split' }); V.store.set('group', { code: o.code, t: tok, e: evOf(o.event.id).id }); });
  }).catch((err) => empty(err.status === 404 ? 'We couldn’t find that order on this device. Sign in, or open the link in your ticket email.' : err.message));
}

if (page === 'tickets') {
  let tab = 'up'; const u = V.user();
  const load = async () => {
    if (u) return (await API.get('/me/tickets'));
    /* Guests: the orders booked on this device. */
    const up = [], past = [];
    for (const m of API.mine.all()) {
      const o = await API.get(`/orders/${m.code}?t=${encodeURIComponent(m.t)}`).catch(() => null);
      if (o) for (const t of o.tickets) (Date.parse(t.event.startsAt) + 9 * 3600e3 > Date.now() ? up : past).push({ ...t, _tok: m.t });
    }
    return { upcoming: up, past };
  };
  const draw = (data) => { const list = (tab === 'up' ? data.upcoming : data.past).filter((t) => t.status !== 'transferred');
    main.innerHTML = `<section class="page-top"><div class="wrap"><div class="head"><div><p class="eyebrow">Your passes</p><h1 class="h-hero" style="margin-top:14px">My <em>tickets</em></h1></div>
      <div class="row">${u ? `<span class="small muted">${esc(u.name)}</span><button class="btn btn-line btn-sm" id="out">Sign Out</button>` : '<a class="btn btn-line btn-sm" href="auth.html">Sign In</a>'}</div></div>
      <div class="tabs" role="tablist"><button role="tab" aria-selected="${tab === 'up'}" data-tab="up">Upcoming</button><button role="tab" aria-selected="${tab === 'past'}" data-tab="past">Past</button></div>
      ${u ? '' : '<p class="note" style="margin-top:12px">Showing tickets booked on this device. Sign in to see every ticket in your name.</p>'}
      <div class="stack" style="margin-top:20px">${list.length ? list.map((t) => `<article class="tk"><div class="photo"><img src="assets/photos/${esc(t.event.art)}.webp" alt=""></div><div class="stack" style="gap:6px"><p><span class="pill ${statusPill(t.status)}</span></p>
          <h2 class="h-card">${esc(t.event.name)}</h2><p class="small muted">${V.date(evOf(t.event.id).date)} · ${esc(t.event.venue)}, ${esc(t.event.city)} · ${esc(t.line)} · ${t.orderCode}</p>
          <div class="row"><button class="btn btn-primary btn-sm" data-view="${t.id}">View Ticket</button>${t.status === 'valid' ? `<button class="btn btn-line btn-sm" data-transfer="${t.id}">Transfer</button><button class="btn btn-line btn-sm" data-refund="${t.orderCode}">Request Refund</button>` : ''}<a class="btn btn-ghost btn-sm" href="${pdfHref(t, t._tok)}">PDF</a></div></div>${t.status === 'valid' ? V.qrImg(t.id, t._tok, t.qr) : ''}</article>`).join('')
        : `<div class="empty"><p>${tab === 'up' ? 'No tickets yet. Your passes appear here the moment you pay.' : 'No past events yet.'}</p><a class="btn btn-primary" href="index.html#events">Find Events</a></div>`}</div></div></section>`;
    const find = (id) => data.upcoming.concat(data.past).find((t) => t.id === id);
    $('#out') && ($('#out').onclick = async () => { await API.logout(); location.reload(); });
    $$('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(data); });
    $$('[data-view]').forEach((b) => b.onclick = () => V.modal({ title: 'Your <em>ticket</em>', html: pass(find(b.dataset.view), null, find(b.dataset.view)._tok).replace('class="pass"', 'class="pass" style="grid-template-columns:1fr;margin:14px 0 0"'), actions: [{ label: 'Done', primary: true }] }));
    $$('[data-transfer]').forEach((b) => b.onclick = () => { if (!u) return V.toast('Sign in to transfer a ticket.');
      V.modal({ title: 'Transfer <em>ticket</em>', html: `<p>The new holder gets a fresh QR and yours stops working.</p><form class="stack" id="tf" style="margin-top:14px"><label class="field">Recipient name<input class="control" name="n" required></label><label class="field">Recipient email<input class="control" type="email" name="m" required></label><button class="btn btn-primary btn-wide">Send Transfer</button></form>`,
        onOpen: (d) => $('#tf', d).onsubmit = async (ev) => { ev.preventDefault(); const f = new FormData(ev.target);
          try { await API.post(`/tickets/${b.dataset.transfer}/transfer`, { toName: f.get('n'), toEmail: f.get('m') }, { idem: API.key() }); d.close(); V.toast(`Transfer sent to ${f.get('n')}. It moves once they accept.`); } catch (err) { V.toast(err.message); } } }); });
    $$('[data-refund]').forEach((b) => b.onclick = () => V.confirm('Request a <em>refund?</em>', 'We will send this to the organizer. If it is approved, the money goes back to the way you paid and this ticket stops working at the gate.', 'Request Refund', async () => {
      const tok = API.mine.token(b.dataset.refund);
      try { await API.post(`/orders/${b.dataset.refund}/refund-request${tok ? `?t=${encodeURIComponent(tok)}` : ''}`, { reason: 'Requested from My Tickets' }, { idem: API.key() }); V.toast('Refund request sent to the organizer.'); } catch (err) { V.toast(err.message); } })); };
  main.innerHTML = '<section class="page-top"><div class="wrap"><p class="eyebrow">Loading your tickets…</p></div></section>';
  load().then(draw).catch((err) => { main.innerHTML = `<section class="page-top"><div class="wrap"><div class="empty"><p>${esc(err.message)}</p><a class="btn btn-primary" href="auth.html">Sign In</a></div></div></section>`; });
  /* A transfer link lands here: accept it. */
  const tr = new URLSearchParams(location.search).get('transfer');
  if (tr) API.post(`/transfers/${encodeURIComponent(tr)}/accept`).then((r) => V.toast(`The ticket is now in ${r.holderName}'s name.`)).catch((err) => V.toast(err.message));
}
})();
