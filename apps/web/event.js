/* VOID · event.js: the event page. Tiers, presale, VIP, checkout, split pay, soundtrack, venue reveal. */
(() => {
const { $, $$, esc, money } = V;
V.chrome('events');
const ctx = V.ctx(), e = V.event(ctx.e), main = $('#main');
const hasVip = !!e.hasVip, has3d = !!e.model, B = window.BOOT;
document.title = `${e.name} · VOID`;
let sel = V.store.get('sel', null); if (sel && (sel.e !== e.id || sel.until < Date.now() || !sel.holdId)) { sel = null; V.store.set('sel', null); }
const release = (s) => s?.holdId && API.del(`/holds/${s.holdId}`, { headers: { 'X-Hold-Secret': s.secret } }).catch(() => null);
let group$ = null; /* the lead's order, read back from the API */
let qty = sel?.qty || 2, split = !!sel?.split, group = sel?.group || 4, method = 'card', timer;
const setSel = (s) => { sel = s; V.store.set('sel', s); };
const go = (id) => $('#' + id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
const groupSel = (id) => `<label class="field">Group size<select class="control" id="${id}">${[2, 3, 4, 5, 6].map((n) => `<option${n === group ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;

function hero() { const st = V.status(e), ok = V.bookable(e);
  return `<section class="ev-hero"><img src="${V.art(e)}" alt=""><div class="wrap">
    <nav class="crumb" aria-label="Breadcrumb"><a href="index.html#events">All events</a><span>/</span><span>${esc(e.genre)}</span><span>/</span><span aria-current="page">${esc(e.name)}</span></nav>
    <div class="row">${V.chip(st)}<span class="chip">${esc(e.genre)}</span></div>
    <h1 class="h-hero" style="margin-top:16px">${esc(e.name)}</h1>
    <ul class="facts"><li><b>${V.date(e.date, true)}</b> · 5 pm to 2 am · Gates at 4 pm (Asia/Colombo)</li><li><b>${esc(e.venue)}</b>, ${esc(e.city)}</li><li>21+ only · ID required</li><li>By VOID Collective · Verified organizer</li></ul>
    <p class="sub">A night of ${esc(e.genre.toLowerCase())} at ${esc(e.venue)}, ${esc(e.city)}. One stage, one crowd, and a room you can walk through before you get there.</p>
    <div class="row" style="margin-top:22px">${ok ? '<button class="btn btn-primary btn-lg" data-go="tickets">Get Tickets</button>' : ''}<button class="btn btn-line btn-lg" id="share">Share Event</button></div>
  </div></section>
  <nav class="subnav" aria-label="On this page"><div class="wrap">${(ok ? [['tickets', 'General Tickets'], ...(hasVip ? [['vip', 'VIP and Tables']] : [])] : []).concat([['music', 'The Music'], ['venue', 'The Venue']]).map(([id, l]) => `<a href="#${id}" data-go="${id}">${l}</a>`).join('')}</div></nav>`; }

function closed() { const st = V.status(e); const v = st === 'Sales paused' ? ['Sales are paused for this event.', 'The platform has paused sales for now. Tickets already bought stay valid.', 'Tell Me When Sales Resume'] : st === 'Sold out' ? ['This one is sold out.', 'Join the waitlist and we will email you if tickets come back.', 'Join Waitlist'] : ['Tickets are not on sale yet.', 'Register your interest and be first to know when they are.', 'Notify Me'];
  const done = V.store.get('notify', {})[e.id];
  return `<section class="sec"><div class="wrap"><div class="closed" role="status"><div><h2 class="h-card" style="font-size:26px">${v[0]}</h2><p class="sub" style="margin-top:6px">${v[1]}</p></div>
    <button class="btn btn-primary" id="notifyBtn" ${done ? 'disabled title="You are already on the list"' : ''}>${done ? 'On the List' : v[2]}</button></div></div></section>`; }

function tiers() { const ts = V.tiers(e);
  return `<section class="sec" id="tickets"><div class="wrap"><div class="head"><div><p class="eyebrow"><b>01</b> / General admission</p><h2 class="h-section">Pick your <em>price</em></h2></div></div>
  <div class="tiers">${ts.map((t) => t.state === 'live' ? `<article class="tier" data-state="live"><div class="tier-top"><h3 class="tier-name">${esc(t.name)}</h3><span class="pill pill-ok">On sale</span></div>
      <p class="tier-price"><small>LKR</small>${t.price.toLocaleString('en-US')}</p><div class="meter" role="img" aria-label="${t.total - t.left} of ${t.total} sold"><i style="width:${(1 - t.left / t.total) * 100}%"></i></div>
      <p class="tier-note" aria-live="polite"><b style="color:var(--ink)">${t.left}</b> of ${t.total} left</p>
      <div class="tier-top"><span class="stepper"><button type="button" id="less" aria-label="Fewer tickets">−</button><output id="qty" aria-live="polite">${qty}</output><button type="button" id="more" aria-label="More tickets">+</button></span></div>
      <label class="switch"><input type="checkbox" id="splitT" ${split ? 'checked' : ''}>Split pay with friends</label>
      <div id="splitBox" ${split ? '' : 'hidden'} class="stack">${groupSel('groupT')}<p class="tier-note" id="each"></p><p class="tier-note">Friends have 48 hours to pay their share.</p></div>
      <button class="btn btn-primary btn-wide" id="pick" data-price="${t.price}" data-name="${esc(t.name)}" data-tier="${t.id}">Get Tickets</button></article>`
    : `<article class="tier" data-state="${t.state}"><div class="tier-top"><h3 class="tier-name">${esc(t.name)}</h3><span class="pill ${t.state === 'sold' ? 'pill-idle">Sold out' : 'pill-warn">Up next'}</span></div>
      <p class="tier-price"><small>LKR</small>${t.price.toLocaleString('en-US')}</p><p class="tier-note">${t.state === 'sold' ? 'Next price opened when this sold out' : 'Opens at the gate'}</p></article>`).join('')}</div>
  <div class="under"><form class="presale" id="presale"><label class="field">Presale code<input class="control" id="code" autocomplete="off" spellcheck="false" placeholder="Enter code"></label><button class="btn btn-line">Apply Code</button></form>
    <div class="badges" aria-label="Ways to pay"><span class="chip">Card</span><span class="chip">Koko · 3 instalments</span><span class="chip">Split pay</span></div></div></div></section>`; }

function vip() { const t = sel?.kind === 'table' ? V.tables().find((x) => x.id === sel.table) : null;
  return `<section class="sec" id="vip"><div class="wrap"><div class="head"><div><p class="eyebrow"><b>02</b> / VIP experience</p><h2 class="h-section">A table for <em>the night</em></h2></div></div>
  <div class="vip-grid">${['gold', 'platinum'].map((k) => { const v = V.VIP[k], free = V.freeTables(k);
    return `<article class="tier"><div class="tier-top"><h3 class="tier-name">${v.name}</h3><span class="pill ${free ? 'pill-ok' : 'pill-idle'}">${free} of 8 tables left</span></div>
      <p class="tier-price"><small>LKR</small>${v.price.toLocaleString('en-US')}<small style="margin-left:8px">per table</small></p><ul class="vip-list">${v.perks.map((p) => `<li>${p}</li>`).join('')}</ul>
      <a class="btn ${free ? 'btn-primary' : 'btn-line'} btn-wide" href="tables.html#e${e.id}-${k}" style="margin-top:auto">Select Tickets</a></article>`; }).join('')}
    <aside class="card" aria-live="polite">${t ? `<p class="eyebrow">Your table</p><h3 class="h-card" style="font-size:28px;margin:8px 0">${t.id} · ${V.VIP[t.tier].name}</h3>
      <div class="side"><dl><dt>Seats</dt><dd>Up to ${t.seats}</dd><dt>Minimum spend</dt><dd>${money(t.price)}</dd></dl></div>
      <label class="switch"><input type="checkbox" id="splitV" ${split ? 'checked' : ''}>Split pay with friends</label>
      <button class="btn btn-primary btn-wide" data-go="checkout" style="margin-top:14px">Reserve This Table</button>`
      : `<p class="eyebrow">How tables work</p><p class="sub" style="margin-top:10px">General admission has no table. Pick Gold or Platinum to open the 3D table map, choose your spot, then come back here to pay.</p><p class="note" style="margin-top:12px">One group QR admits the whole table.</p>`}</aside></div></div></section>`; }

function checkout() {
  if (!sel) return `<section class="sec" id="checkout"><div class="wrap"><div class="co-lock"><h2 class="h-card" style="font-size:24px">Checkout</h2><p style="margin-top:8px">Choose a ticket tier${hasVip ? ' or a VIP table' : ''} above and your order appears here.</p></div></div></section>`;
  const u = V.user(), c = V.calc({ qty: sel.qty, unit: sel.unit, group: split ? group : 1 }), due = split ? c.share : c.total, third = Math.ceil(due / 3);
  return `<section class="sec" id="checkout"><div class="wrap"><div class="head"><div><p class="eyebrow"><b>03</b> / Checkout</p><h2 class="h-section">Nearly <em>there</em></h2></div></div>
  <form class="co" id="coForm"><div class="card stack"><p class="eyebrow">Your details · Step 2 of 3</p>
    <label class="field">Full name<input class="control" name="name" required autocomplete="name" value="${esc(u?.name || '')}"></label>
    <div class="grid2"><label class="field">Mobile<input class="control" name="mobile" type="tel" required pattern="[0-9+ ]{9,18}" autocomplete="tel" placeholder="077 123 4567" title="9 to 18 digits"></label>
    <label class="field">Email<input class="control" name="email" type="email" required autocomplete="email" value="${esc(u?.email || '')}"></label></div>
    ${u ? '' : '<p class="note">Checking out as a guest. <a class="link" href="auth.html#next-event">Sign in</a> to keep every ticket in one place.</p>'}
    <label class="switch"><input type="checkbox" id="splitC" ${split ? 'checked' : ''}>Split pay with friends</label>${split ? groupSel('groupC') : ''}
    <fieldset style="border:0;padding:0;margin:0"><legend class="field" style="margin-bottom:8px">How would you like to pay?</legend><div class="pay-choice">
      <label><input type="radio" name="method" value="card" ${method === 'card' ? 'checked' : ''}>Card</label><label><input type="radio" name="method" value="koko" ${method === 'koko' ? 'checked' : ''}>Koko</label></div></fieldset>
    ${method === 'card' ? `<div class="grid2"><label class="field" style="grid-column:1/-1">Card number<input class="control" value="4242 4242 4242 4242" disabled></label><label class="field">Expiry<input class="control" value="12 / 29" disabled></label><label class="field">CVC<input class="control" value="•••" disabled></label></div><p class="note">Demo card. Do not enter real payment details. Card payments run through PayHere.</p>`
      : `<div class="card" style="padding:18px;border-radius:var(--r-panel)"><p><b>${money(third)} today</b>, then two monthly payments of ${money(third)}.</p><p class="note" style="margin-top:6px">Interest free with Koko. You approve the plan on Koko's page.</p></div>`}
    <label class="check"><input type="checkbox" required>I agree to the&nbsp;<button type="button" class="link" data-info="Terms" style="min-height:0">Terms</button>&nbsp;and&nbsp;<button type="button" class="link" data-info="Refund policy" style="min-height:0">Refund policy</button></label></div>
  <aside class="card sum"><p class="eyebrow">Order summary</p><h3 class="h-card" style="margin:8px 0 2px">${esc(e.name)}</h3><p class="small muted">${V.date(e.date)} · ${esc(e.venue)}, ${esc(e.city)}</p>
    <dl style="margin-top:16px"><dt>${esc(sel.label)}</dt><dd>${money(c.subtotal)}</dd><dt>Booking fee (${c.pct}%)</dt><dd>${money(c.fee)}</dd><dt class="tot">Total</dt><dd class="tot">${money(c.total)}</dd>
      ${split ? `<dt>Your share (1 of ${group})</dt><dd><b>${money(c.share)}</b></dd>` : ''}</dl>
    <p class="hold" role="timer" aria-live="off"><span>We're holding this for you</span><b id="hold"></b></p>
    <button class="btn btn-primary btn-lg btn-wide">${split ? 'Pay My Share' : 'Pay Now'} · ${money(method === 'koko' ? third : due)}</button>
    <p class="note" style="margin-top:10px;text-align:center">PayHere · Koko</p><button type="button" class="btn btn-ghost btn-wide btn-sm" id="cancelSel">Start Over</button></aside></form></div></section>`; }

function splitView() { const sh = B.share;
  if (sh) { if (sh.error) return `<section class="sec" id="split"><div class="wrap"><div class="co-lock"><h2 class="h-card" style="font-size:24px">This share link isn't working</h2><p style="margin-top:8px">${esc(sh.error.message)}</p></div></div></section>`;
    const paid = sh.share.status === 'paid', open = sh.group.status === 'open';
    return `<section class="sec" id="split"><div class="wrap"><div class="card" style="max-width:640px;margin:auto;text-align:center"><p class="eyebrow">${esc(sh.lead)} invited you</p><h2 class="h-section" style="font-size:clamp(34px,4vw,52px);margin:12px 0">Your Share of <em>the Night</em></h2>
      <p class="sub" style="margin:auto">${esc(sh.line)} at ${esc(e.name)}, ${V.date(e.date)}. ${sh.group.paid} of ${sh.group.size} paid.</p><p class="tier-price" style="margin:18px 0"><small>LKR</small>${(sh.share.amountCents / 100).toLocaleString('en-US')}</p>
      ${paid ? `<p class="done-line" style="justify-content:center">${V.icon('check')} Your share is paid.</p>` : !open ? `<p class="note">${sh.group.status === 'complete' ? 'Everyone has paid. See you there.' : 'This group booking was released.'}</p>` : !sh.group.leadPaid ? `<p class="note">${esc(sh.lead)} hasn't paid their share yet. Check back soon.</p>`
        : `<form class="stack" id="shareForm" style="text-align:left;max-width:420px;margin:0 auto"><label class="field">Full name<input class="control" name="name" required autocomplete="name"></label><label class="field">Email<input class="control" name="email" type="email" required autocomplete="email"></label><label class="field">Mobile<input class="control" name="mobile" type="tel" required pattern="[0-9+ ]{9,18}" placeholder="077 123 4567"></label><button class="btn btn-primary btn-lg">Pay Share · ${money(sh.share.amountCents / 100)}</button></form>`}
      <p class="note" style="margin-top:12px">${V.DEMO ? 'Demo payment. A signed PayHere sandbox callback is simulated.' : ''}</p><p style="margin-top:12px"><a class="link" href="event.html#e${e.id}">Back to the event</a></p></div></div></section>`; }
  const o = group$;
  if (!o) return `<section class="sec" id="split"><div class="wrap"><div class="co-lock"><h2 class="h-card" style="font-size:24px">Group payment</h2><p style="margin-top:8px">Turn on split pay and each friend gets their own link. Their status shows here once you have paid your share.</p></div></div></section>`;
  const done = o.split.status === 'complete';
  return `<section class="sec" id="split"><div class="wrap"><div class="head"><div><p class="eyebrow"><b>04</b> / Group payment</p><h2 class="h-section">Everyone <em>in?</em></h2></div></div>
    <div class="banner"><b>${done ? 'Everyone has paid. See you there.' : o.split.status === 'released' ? 'This group was released. Paid shares are refunded.' : 'Your share is paid. The night is on its way.'}</b><span>Order ${o.code}${done || !o.split.expiresAt ? '' : ` · <span id="splitLeft"></span> left`}</span></div>
    <div class="stack">${o.split.shares.map((p, i) => `<div class="friend"><span class="av">${i === 0 ? V.initials(o.buyer.name) : 'F' + i}</span><div class="grow"><b>${i === 0 ? esc(o.buyer.name) + ' (you)' : esc(p.name)}</b><p class="small muted num">${money(p.amountCents / 100)}</p></div>
      <span class="pill ${p.status === 'paid' ? 'pill-ok">Paid' : p.status === 'refunded' ? 'pill-bad">Refunded' : 'pill-warn">Waiting'}</span>${p.link ? `<button class="btn btn-line btn-sm" data-link="${esc(p.link)}">Copy Link</button><a class="btn btn-ghost btn-sm" href="${esc(p.link)}">Open</a>` : ''}</div>`).join('')}</div>
    <p class="note" style="margin-top:14px">If the group does not finish in 48 hours the reservation is released and paid shares are refunded.</p>${done ? `<p style="margin-top:16px"><a class="btn btn-primary" href="confirmation.html?order=${o.code}&t=${encodeURIComponent(API.mine.token(o.code) || '')}">View Tickets</a></p>` : ''}</div></section>`; }

const rest = () => `<section class="sec" id="music"><div class="wrap"><div class="head"><div><p class="eyebrow"><b>05</b> / The soundtrack</p><h2 class="h-section">Before the <em>doors</em></h2></div></div>
  <div class="card sound"><div class="photo"><img src="${V.art(e)}" alt=""></div><div><div class="row"><button class="btn btn-primary" id="play" aria-pressed="false">${V.icon('play')} Preview</button><span class="small muted">The warm-up playlist · 24 tracks</span></div>
    <ol class="tracks"><li>Lotus Road <span>6:12</span></li><li>Beira After Dark <span>5:48</span></li><li>Gates at Four <span>7:03</span></li></ol><p class="note">A Spotify embed sits here once the organizer links a playlist.</p></div></div></div></section>
<section class="sec" id="venue"><div class="wrap"><div class="head"><div><p class="eyebrow"><b>06</b> / Know the venue</p><h2 class="h-section">Reach into <em>the room</em></h2></div></div>
  <div class="reveal-card"><img src="${V.art(e)}" alt=""><div><p class="eyebrow">${has3d ? '3D venue view' : 'Venue layout'}</p><h3 class="h-section" style="font-size:clamp(30px,4vw,52px);margin:12px 0 20px">See ${esc(e.venue)} <em>before you arrive</em></h3>
    <a class="btn btn-primary btn-lg" href="venue.html#e${e.id}">${V.icon('cube')} Click to Reveal</a></div></div>
  <div class="strip" style="margin-top:14px"><div><h3 class="h-card">Questions before the night?</h3><p class="small muted">${e.organizer ? esc(e.organizer) + ' runs this event.' : 'An organizer is being assigned.'}</p></div><button class="btn btn-line" id="contactOrg">Contact Organizer</button></div></div></section>`;

function render(keepScroll) { const y = scrollY, ok = V.bookable(e), lt = V.liveTier(e);
  main.innerHTML = hero() + (B.share ? splitView() : (ok ? tiers() + (hasVip ? vip() : '') + checkout() + splitView() : closed())) + rest()
    + (ok && lt ? `<div class="mbar"><div><small>${esc(lt.name)}</small><b>${money(lt.price)}</b></div><button class="btn btn-primary" data-go="tickets">Get Tickets</button></div>` : '');
  if (keepScroll) scrollTo(0, y); wire(); }

function wire() { clearInterval(timer);
  const each = () => { const b = $('#each'); if (b) { const p = +$('#pick').dataset.price; b.textContent = `Each pays ${money(V.calc({ qty, unit: p, group }).share)}`; } }; each();
  $('#less') && ($('#less').onclick = () => { qty = Math.max(1, qty - 1); $('#qty').textContent = qty; each(); });
  $('#more') && ($('#more').onclick = () => { qty = Math.min(10, qty + 1); $('#qty').textContent = qty; each(); });
  $('#splitT') && ($('#splitT').onchange = (ev) => { split = ev.target.checked; $('#splitBox').hidden = !split; each(); });
  $('#groupT') && ($('#groupT').onchange = (ev) => { group = +ev.target.value; each(); });
  const pick = async (kind, unit, name, tierId, presaleCode) => { const btn = $('#pick'); if (btn) btn.disabled = true;
    try { await release(sel); const h = await API.post('/holds', { kind: 'tier', eventId: e.slug, tierId, qty, ...(presaleCode ? { presaleCode } : {}) }, { idem: API.key() });
      setSel({ e: e.id, kind, qty, unit: h.unitCents / 100, split, group, label: h.label, until: Date.parse(h.displayExpiresAt), holdId: h.id, secret: h.secret }); render(true); go('checkout'); }
    catch (err) { V.toast(err.message); if (btn) btn.disabled = false; } };
  $('#pick') && ($('#pick').onclick = (ev) => pick('tier', +ev.target.dataset.price, ev.target.dataset.name, ev.target.dataset.tier));
  $('#presale') && ($('#presale').onsubmit = async (ev) => { ev.preventDefault(); const v = $('#code').value.trim().toUpperCase(); if (!v) return;
    let r; try { r = await API.post(`/events/${e.slug}/presale`, { code: v }); } catch (err) { return V.toast(err.status === 400 ? "That code isn't valid for this event." : err.message); }
    const price = r.priceCents / 100, tierId = V.liveTier(e)?.id;
    V.modal({ title: 'Presale <em>Unlocked</em>', html: `<p>Your code opens a hidden price of <b>${money(price)}</b> per ticket for ${esc(e.name)}.</p>`, actions: [{ label: `Use ${money(price)} Per Ticket`, primary: true, onClick: () => { pick('presale', price, 'Presale', tierId, v); } }, { label: 'Not Now' }] }); });
  $('#splitV') && ($('#splitV').onchange = (ev) => { split = ev.target.checked; setSel({ ...sel, split }); render(true); });
  $('#splitC') && ($('#splitC').onchange = (ev) => { split = ev.target.checked; setSel({ ...sel, split }); render(true); });
  $('#groupC') && ($('#groupC').onchange = (ev) => { group = +ev.target.value; setSel({ ...sel, group }); render(true); });
  $$('[name=method]').forEach((r) => r.onchange = () => { method = r.value; const f = new FormData($('#coForm')); render(true); ['name', 'mobile', 'email'].forEach((k) => $(`[name=${k}]`).value = f.get(k)); });
  const drop = (msg) => { release(sel); setSel(null); render(true); if (msg) V.toast(msg); };
  $('#cancelSel') && ($('#cancelSel').onclick = () => drop());
  if ($('#hold')) { const t = () => { const left = sel.until - Date.now(); if (left <= 0) return drop('Your hold ran out. Pick your tickets again.'); $('#hold').textContent = V.fmtLeft(left); }; t(); timer = setInterval(t, 1000); }
  $('#coForm') && ($('#coForm').onsubmit = async (ev) => { ev.preventDefault(); const f = new FormData(ev.target), btn = ev.submitter; if (btn) btn.disabled = true;
    try {
      const r = await API.post('/checkout', { holdId: sel.holdId, holdSecret: sel.secret, buyer: { name: f.get('name').trim(), email: f.get('email'), mobile: f.get('mobile') }, payMethod: split ? 'card' : method, acceptTerms: true, ...(split ? { split: { size: group } } : {}) }, { idem: API.key() });
      API.mine.add(r.order.code, r.viewToken); clearInterval(timer);
      const how = await API.pay(r.payment, r.demo);
      if (how !== 'paid') return;
      setSel(null);
      if (split) { group$ = await API.get(`/orders/${r.order.code}?t=${encodeURIComponent(r.viewToken)}`); V.store.set('group', { code: r.order.code, t: r.viewToken, e: e.id }); render(); go('split'); V.toast('Your share is paid.'); }
      else location.href = `confirmation.html?order=${r.order.code}&t=${encodeURIComponent(r.viewToken)}`;
    } catch (err) { V.toast(err.message); if (btn) btn.disabled = false; if (err.status === 410) drop(); } });
  if ($('#splitLeft')) { const until = Date.parse(group$.split.expiresAt); const t = () => $('#splitLeft') && ($('#splitLeft').textContent = V.fmtLeft(until - Date.now())); t(); timer = setInterval(t, 30000); }
  $$('[data-link]').forEach((b) => b.onclick = () => V.copy(b.dataset.link, 'Link copied'));
  $('#shareForm') && ($('#shareForm').onsubmit = async (ev) => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
    try { const r = await API.post(`/split/${encodeURIComponent(B.shareToken)}/pay`, f, { idem: API.key() }); if (await API.pay(r.payment, r.demo) !== 'paid') return;
      B.share = await API.get(`/split/${encodeURIComponent(B.shareToken)}`); V.toast(B.share.group.status === 'complete' ? 'All shares paid. Tickets are on their way.' : 'Your share is paid.'); render(true); } catch (err) { V.toast(err.message); } });
  $('#notifyBtn') && ($('#notifyBtn').onclick = (ev) => V.notify(e, ev.target.textContent));
  $('#share').onclick = () => V.copy(`${location.href.split('#')[0]}#e${e.id}`, 'Link copied');
  $('#contactOrg').onclick = () => V.modal({ title: 'Contact <em>Organizer</em>', html: `<form class="stack" id="cf"><label class="field">Your email<input class="control" type="email" required></label><label class="field">Message<textarea class="control" required placeholder="What would you like to know?"></textarea></label><button class="btn btn-primary btn-wide">Send Message</button></form>`, onOpen: (d) => $('#cf', d).onsubmit = (x) => { x.preventDefault(); d.close(); V.toast(V.DEMO ? 'Demo only. No message was sent.' : 'Message sent.'); } });
  $('#play').onclick = (ev) => { const b = ev.currentTarget, on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); b.innerHTML = on ? `${V.icon('pause')} Pause` : `${V.icon('play')} Preview`; if (on) V.toast('Preview audio plays once a playlist is linked.'); };
  $$('[data-go]').forEach((b) => b.onclick = (ev) => { ev.preventDefault(); go(b.dataset.go); });
  const lt = $('.tiers .tier[data-state=live]'); if (lt && lt.parentNode.scrollWidth > lt.parentNode.clientWidth) lt.parentNode.scrollLeft = lt.offsetLeft - lt.parentNode.offsetLeft - 16;
  V.reveal(); }

const g = V.store.get('group', null);
(g && g.e === e.id && !B.share ? API.get(`/orders/${g.code}?t=${encodeURIComponent(g.t)}`).then((o) => { group$ = o; }).catch(() => V.store.set('group', null)) : Promise.resolve()).then(() => { render(); jump(); });
if (B.error) V.toast('We could not reach the server. Showing what we have.');
document.addEventListener('void:notify', () => render(true));
function jump() { const want = V.store.get('scrollTo', null); if (want) { V.store.set('scrollTo', null); if (want.id) requestAnimationFrame(() => $('#' + want.id)?.scrollIntoView()); else if (want.y) scrollTo(0, want.y); } }
$('#main').addEventListener('click', (ev) => { const a = ev.target.closest('a[href^="venue.html"],a[href^="tables.html"]'); if (a) V.store.set('back', { e: e.id, y: scrollY }); });
})();
