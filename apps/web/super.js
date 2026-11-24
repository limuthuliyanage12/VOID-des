/* VOID · super.js: the platform console on the API. Every event and organizer, approvals, payouts, fees and the audit log. */
(async () => {
const { $, esc, short } = V;
const money = (c) => V.money(c / 100), shortC = (c) => short(c / 100), n = (v) => (v ?? 0).toLocaleString('en-US');
const u = await K.gate(['super'], 'Platform workspace');
const A = {};
const SLICES = { overview: '/overview', events: '/events?limit=200', admins: '/admins', venues: '/venues', layouts: '/layouts', revenue: '/revenue', payouts: '/payouts', fees: '/settings/fees', settings: '/settings', users: '/users?limit=200', audit: '/audit?limit=200', privacy: '/privacy/requests' };
const load = (...keys) => Promise.all(keys.map(async (k) => { A[k] = await API.get('/super' + SLICES[k]).catch((e) => ({ error: e })); }));
await load(...Object.keys(SLICES));
const detail = {};
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const when = (d) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Colombo' });
const evs = () => A.events.items || [];
const decide = (id, to) => { const e = evs().find((x) => x.id === id); const label = to === 'approve' ? 'Approve' : 'Reject';
  const go = (note) => K.run(() => API.post(`/super/events/${id}/${to}`, note ? { note } : {}, { idem: API.key() }), (r) => `${r.name} is ${r.label.toLowerCase()}.`, () => load('events', 'overview', 'admins').then(() => { delete detail[id]; }));
  if (to === 'reject') return K.form(`Reject <em>${esc(e.name)}?</em>`, [{ k: 'note', l: 'Note for the organizer', req: false }], 'Reject', (f) => { go(f.note); });
  V.confirm(`${label} <em>${esc(e.name)}?</em>`, 'It goes live on the fan site and the organizer can start selling.', label, () => { go(); }); };

const screens = {
overview() { const o = A.overview, d = o.decisions, k = o.kpis;
  const q = [[d.eventRequests, `event request${d.eventRequests === 1 ? '' : 's'} to review`, 'events'], [d.payoutBatches, `payout batch${d.payoutBatches === 1 ? '' : 'es'} awaiting approval`, 'payouts'], [d.layoutsToReview, `venue layout${d.layoutsToReview === 1 ? '' : 's'} to review`, 'venues'], [d.eventsWithoutAdmin, `event${d.eventsWithoutAdmin === 1 ? '' : 's'} with no admin`, 'admins']].filter((x) => x[0]);
  const region = o.byRegion.sort((a, b) => b.grossCents - a.grossCents);
  return { html: K.head('Overview', `<b>${q.reduce((a, x) => a + x[0], 0)} decisions</b> are waiting for you. The platform has grossed <b>${shortC(k.grossCents)}</b>.`, K.btn('Export report', 'report')) +
    K.card('Needs your decision', `<ul class="alerts">${q.map(([c, t, go]) => `<li><span><b>${c}</b> ${t}</span>${K.btn('Open', 'go', { arg: go })}</li>`).join('') || '<li>Nothing is waiting on you.</li>'}</ul>`) +
    `<div style="margin-top:12px">${K.kpis([['Gross', shortC(k.grossCents), 'all events'], [`Fees earned (${k.bookingFeePercent}%)`, shortC(k.feesCents), 'booking fees'], ['Tickets sold', n(k.ticketsSold), `${o.byEvent.length} events`], ['Events live', k.eventsLive, `of ${o.byEvent.length}`]])}</div>
    <div class="c-grid">${K.card('Revenue by event', K.bars(o.byEvent.filter((e) => e.grossCents).map((e) => [esc(e.name), e.grossCents, shortC(e.grossCents)])), { span: 's7' })}
    ${K.card('Revenue by region', K.bars(region.map((r) => [r.name, r.grossCents, shortC(r.grossCents)])), { span: 's5' })}
    ${K.table('Biggest events', [{ k: 'name', l: 'Event' }, { k: 'v', l: 'Venue' }, { k: 's', l: 'Tickets', r: 1 }, { k: 'g', l: 'Gross', r: 1 }], o.byEvent.slice(0, 4).map((e) => ({ name: esc(e.name), v: esc(e.venue), s: n(e.sold), g: money(e.grossCents), _click: 'events-' + e.id })), { span: 's7', search: false })}
    ${K.card('System status', `<div class="status-strip">${[['API', o.system.api], ['Database', o.system.database], ['Jobs', o.system.jobs], ['Payments', o.system.payments], ['Koko', o.system.koko]].map(([s, v]) => `<span>${K.pill(v === 'ok' ? 'Operational' : cap(v))} ${s}</span>`).join('')}</div>`, { span: 's5' })}</div>`,
    acts: { go: (a) => K.go(a), report: () => K.csvFrom('VOID platform report', '/super/report.csv') } }; },

events(arg) { if (arg) return screens.detail(arg);
  const q = sessionStorage.getItem('void.sq') || ''; sessionStorage.removeItem('void.sq');
  return { html: K.head('Events', `<b>${A.events.inReview} events</b> are in review.`) +
    K.table('All events', [{ k: 'name', l: 'Event' }, { k: 'v', l: 'Venue' }, { k: 'ad', l: 'Admin' }, { k: 'st', l: 'Status' }, { k: 's', l: 'Tickets', r: 1 }, { k: 'g', l: 'Revenue', r: 1 }, { k: 'a', l: '', r: 1 }],
      evs().map((e) => ({ name: `<b>${esc(e.name)}</b><br><span class="muted small">${e.date}</span>`, v: `${esc(e.venue)}, ${esc(e.city)}`, ad: e.admin ? esc(e.admin) : K.pill('No admin'), st: K.pill(e.label), s: n(e.sold), g: money(e.grossCents), _status: e.label, _click: 'events-' + e.id, a: e.label === 'In review' ? `${K.link('Approve', 'approve', e.id)} ${K.link('Reject', 'reject', e.id)}` : '' })), { filter: ['Live', 'In review', 'Sold out', 'Suspended', 'Rejected'], id: 'evTable' }),
    acts: { approve: (id) => decide(id, 'approve'), reject: (id) => decide(id, 'reject') },
    wire: (root) => { if (q) { const i = $('[data-tsearch]', root); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); } } }; },

detail(id) { const d = detail[id];
  if (!d) { API.get(`/super/events/${id}`).then((r) => { detail[id] = r; K.refresh(); }).catch((e) => V.toast(e.message)); return { crumb: 'Events', html: K.head('Loading…', 'Fetching the event.') }; }
  const k = d.kpis, reload = () => load('events', 'overview').then(() => { delete detail[id]; });
  return { crumb: `Events / ${d.name}`, html: `<p style="margin-bottom:12px"><a class="link" href="#events">All events</a></p><div class="c-card" style="overflow:hidden;margin-bottom:12px"><div style="height:180px;position:relative"><img src="assets/photos/${esc(d.art)}.webp" alt="" style="width:100%;height:100%;object-fit:cover;filter:grayscale(1) brightness(.55)"></div></div>` +
    K.head(esc(d.name), `${d.date} · ${esc(d.venue)}, ${esc(d.city)} · ${K.pill(d.label)}`, (d.canApprove ? K.btn('Approve', 'approve', { primary: true }) : '') + (d.paused ? K.btn('Restore sales', 'restore', { primary: true }) : d.canPause ? K.btn('Pause sales', 'pause') : '')) +
    K.kpis([['Tickets sold', n(k.sold), `of ${n(d.capacity)} capacity`], ['Gross', shortC(k.grossCents), 'to date'], ['Fees', shortC(k.feesCents), 'platform share'], ['Sell-through', Math.round(k.sold / (d.capacity || 1) * 100) + '%', 'of capacity']]) +
    `<div class="c-grid">${K.card('Revenue by tier', K.bars(d.revenueByTier.map((t) => [t.name, t.revenueCents, `${n(t.sold)} sold · ${shortC(t.revenueCents)}`]), { all: true }), { span: 's7' })}
    ${K.card('Ownership and payout', `<div class="barrow"><span>Organizer</span><span></span><b>${esc(d.ownership.organizer?.name || 'None yet')}</b></div><div class="barrow"><span>Organizer net</span><span></span><b>${money(k.netCents)}</b></div><div class="barrow"><span>Refund reserve</span><span></span><b>${money(k.reserveCents)}</b></div><div class="barrow"><span>Payout account</span><span></span><b>${d.ownership.payoutAccount ? `${esc(d.ownership.payoutAccount.bank)} •••• ${esc(d.ownership.payoutAccount.last4)}` : 'Not set'}</b></div>`, { span: 's5' })}</div>`,
    acts: { approve: () => decide(id, 'approve'),
      pause: () => V.confirm(`Pause sales for <em>${esc(d.name)}?</em>`, 'The fan page shows sales paused and checkout is blocked straight away. Tickets already bought stay valid, and refunds and payouts carry on.', 'Pause Sales', () => { K.run(() => API.post(`/super/events/${id}/suspend`, {}, { idem: API.key() }), 'Sales paused. The fan page has changed.', reload); }),
      restore: () => K.run(() => API.post(`/super/events/${id}/restore`, {}, { idem: API.key() }), 'Sales restored.', reload) } }; },

admins() { const a = A.admins.items || [], open = a.filter((x) => !x.admin);
  return { html: K.head('Admins', `<b>${open.length} event${open.length === 1 ? ' has' : 's have'}</b> no admin yet.`, K.btn('Invite admin', 'invite', { primary: true })) +
    `<div class="c-grid">${K.table('Who runs which event', [{ k: 'e', l: 'Event' }, { k: 'ad', l: 'Admin' }, { k: 'st', l: 'Account' }, { k: 'x', l: '', r: 1 }], a.map((x) => ({ e: esc(x.event), ad: x.admin ? `<span style="display:inline-flex;gap:8px;align-items:center"><span class="av">${V.initials(x.admin.name)}</span>${esc(x.admin.name)}</span>` : K.pill('No admin'), st: x.admin ? K.pill(x.admin.status === 'active' ? (x.admin.mfa ? 'Active · 2-step on' : 'Active') : cap(x.admin.status)) : '', x: x.canInvite ? K.link('Invite', 'invite', x.eventId) : '' })), { span: 's8' })}
    ${K.card('How access works', `<ul class="alerts"><li>${esc(A.admins.rule)}</li><li>An admin sees only their own event's orders, money and layout.</li><li>Only you can assign or remove an admin.</li><li>An event with no admin can't go live.</li></ul>`, { span: 's4' })}</div>`,
    acts: { invite: (id) => { const list = id ? a.filter((x) => x.eventId === id) : open; if (!list.length) return V.toast('Every event already has an admin.');
      K.form('Invite <em>admin</em>', [{ k: 'name', l: 'Name' }, { k: 'email', l: 'Email', t: 'email' }, { k: 'event', l: 'Event', options: list.map((x) => x.event) }], 'Send Invite', (f) => { const ev = list.find((x) => x.event === f.event);
        K.run(() => API.post('/super/admins/invite', { name: f.name, email: f.email, eventId: ev.eventId }, { idem: API.key() }), `Invite sent to ${f.name}.`, () => load('admins', 'events', 'overview')); }); } } }; },

venues() { const vs = A.venues.items || [], ls = A.layouts.items || [], waiting = ls.filter((l) => l.status === 'awaiting review');
  const label = { draft: 'Draft', 'awaiting review': 'Awaiting review', approved: 'Approved', 'changes requested': 'Changes requested' };
  return { html: K.head('Venues', waiting.length ? `Layout <b>v${waiting[0].version}</b> for ${esc(waiting[0].event)} is <b>waiting for your review</b>.` : `<b>${vs.filter((v) => v.modelStatus === 'ready').length} of ${vs.length} venues</b> have a 3D model ready.`, K.btn('Add venue', 'add', { primary: true })) +
    `<div class="kpis">${vs.map((v) => `<div class="kpi"><p class="kpi-label">${esc(v.city)}</p><p class="kpi-value" style="font-size:20px">${esc(v.name)}</p><p class="kpi-note">${n(v.capacity)} capacity</p><p style="margin-top:10px">${K.pill(v.modelStatus === 'ready' ? 'Ready' : v.modelStatus === 'in review' ? 'In review' : 'No 3D model')}</p></div>`).join('')}</div>
    <div class="c-grid">${K.table('Layouts published by organizers', [{ k: 'e', l: 'Event' }, { k: 'v', l: 'Version' }, { k: 'o', l: 'Objects', r: 1 }, { k: 't', l: 'Tables', r: 1 }, { k: 'st', l: 'Status' }, { k: 'a', l: '', r: 1 }], ls.map((l) => ({ e: esc(l.event), v: 'v' + l.version, o: l.summary.objects, t: l.tables, st: K.pill(label[l.status] || l.status), a: l.status === 'awaiting review' ? `${K.link('Approve', 'approve', l.id)} ${K.link('Request changes', 'changes', l.id)}` : `<span class="muted">${l.live ? 'Live on the fan table map' : esc(l.reviewNote || '')}</span>` })), { search: false })}</div>`,
    acts: { approve: (id) => K.run(() => API.post(`/super/layouts/${id}/approve`, {}, { idem: API.key() }), (r) => r.message, () => load('layouts', 'overview')),
      changes: (id) => K.form('Request <em>changes</em>', [{ k: 'note', l: 'Note for the organizer' }], 'Send Back', (f) => { K.run(() => API.post(`/super/layouts/${id}/request-changes`, { note: f.note }), 'Sent back to the organizer.', () => load('layouts', 'overview')); }),
      add: () => K.form('Add <em>venue</em>', [{ k: 'name', l: 'Venue name' }, { k: 'city', l: 'City' }, { k: 'cap', l: 'Capacity', t: 'number', attr: 'min="1"' }, { k: 'region', l: 'Region', options: ['Colombo', 'South coast', 'Hill country'] }], 'Add Venue', (f) => { K.run(() => API.post('/super/venues', { name: f.name, city: f.city, capacity: +f.cap, region: f.region }), 'Venue added. It needs a 3D model before organizers can build on it.', () => load('venues')); }) } }; },

revenue() { const r = A.revenue, k = r.kpis, g = k.grossCents || 1, pc = (v) => (v / g * 100).toFixed(1) + '%';
  return { html: K.head('Revenue', `Of every rupee, <b>${pc(k.organizerNetCents)}</b> goes to organizers and <b>${pc(k.feesCents)}</b> is platform fees.`, K.btn('Export', 'csv')) +
    K.kpis([['Gross', shortC(k.grossCents), 'all events'], ['Organizer net', shortC(k.organizerNetCents), 'after fees and refunds'], ['Platform fees', shortC(k.feesCents), `${A.fees.bookingFeePercent}% booking fee`], ['Refunds', shortC(k.refundsCents), 'returned to fans']]) +
    `<div class="c-grid">${K.card('Where each rupee goes', `<div class="splitbar" role="img" aria-label="Organizer net ${pc(k.organizerNetCents)}, platform fees ${pc(k.feesCents)}, refunds ${pc(k.refundsCents)}"><div style="width:${k.organizerNetCents / g * 100}%;background:var(--light);color:#000">Organizer net ${pc(k.organizerNetCents)}</div><div style="width:${k.feesCents / g * 100}%;background:var(--muted);color:#000">Fees</div><div style="width:${Math.max(2, k.refundsCents / g * 100)}%;background:#444"></div></div><p class="note" style="margin-top:10px">Organizer net ${money(k.organizerNetCents)} · Fees ${money(k.feesCents)} · Refunds ${money(k.refundsCents)}</p>`)}
    ${r.weekly.length ? K.card('Flagship tickets per week', K.charts.bars(r.weekly.map((w, i) => ({ l: w.week, v: w.tickets, accent: i === 0, partial: i === r.weekly.length - 1 })), { label: 'Tickets per week for the biggest event.' }), { span: 's7' }) : ''}
    ${K.card('By genre', K.bars(r.byGenre.map((x) => [x.name, x.grossCents, shortC(x.grossCents)])), { span: 's5' })}
    ${K.card('By region', K.bars(r.byRegion.map((x) => [x.name, x.grossCents, shortC(x.grossCents)])), { span: 's6' })}
    ${K.card('Sell-through', K.bars(r.byEvent.filter((e) => e.sold).map((e) => [esc(e.name), e.sellThroughPercent, Math.round(e.sellThroughPercent) + '%']), { max: 100, all: true }), { span: 's6' })}
    ${K.table('Revenue statement', [{ k: 'e', l: 'Event' }, { k: 'g', l: 'Gross', r: 1 }, { k: 'f', l: 'Fees', r: 1 }, { k: 'r', l: 'Refunds', r: 1 }, { k: 'n', l: 'Organizer net', r: 1 }], r.byEvent.filter((e) => e.grossCents).map((e) => ({ e: esc(e.name), g: money(e.grossCents), f: money(e.feesCents), r: money(e.refundsCents), n: money(e.netCents) })).concat([{ e: '<b>Total</b>', g: `<b>${money(k.grossCents)}</b>`, f: `<b>${money(k.feesCents)}</b>`, r: `<b>${money(k.refundsCents)}</b>`, n: `<b>${money(k.organizerNetCents)}</b>` }]), { search: false })}</div>`,
    acts: { csv: () => K.csvFrom('VOID revenue statement', '/super/revenue.csv') } }; },

payouts() { const P = A.payouts, cols = [{ k: 'code', l: 'Batch' }, { k: 'e', l: 'Event' }, { k: 'd', l: 'Date' }, { k: 'amt', l: 'Amount', r: 1 }, { k: 'st', l: 'Status' }, { k: 'a', l: '', r: 1 }];
  const row = (p) => ({ code: p.code, e: esc(p.event), d: p.date, amt: money(p.amountCents), st: K.pill(cap(p.status)), a: p.status === 'awaiting approval' ? K.link('Approve', 'approve', p.code) : p.status === 'approved' ? K.link('Mark paid', 'paid', p.code) : `<span class="muted">${esc(p.bankRef || '')}</span>` });
  const trail = (A.audit.items || []).filter((a) => /payout/i.test(a.action));
  return { html: K.head('Payouts', `<b>${P.finding.batches} batches</b> worth <b>${money(P.finding.amountCents)}</b> are awaiting approval.`) +
    `<div class="c-grid">${K.table('Awaiting approval', cols, P.awaiting.concat(P.approved).map(row), { search: false, empty: 'No batches are waiting.' })}
    ${K.table('Paid batches', cols, P.paid.map(row), { span: 's7', search: false })}
    ${K.card('Checked before release', `<ul class="alerts"><li>Bank details verified for the organizer</li><li>Refund reserve of ${A.settings.rules.refundReservePercent}% held back</li><li>No open chargebacks on the event</li><li>Amount matches the event statement</li></ul>`, { span: 's5', foot: 'Approval records the decision and produces a bank file. It does not move money by itself.' })}
    ${K.table('Payout trail', [{ k: 't', l: 'When' }, { k: 'w', l: 'Who' }, { k: 'a', l: 'Action' }, { k: 'x', l: 'Batch' }], trail.map((a) => ({ t: when(a.at), w: esc(a.who), a: esc(a.action), x: esc(a.target) })), { search: false })}</div>`,
    acts: { approve: (c) => { const p = P.awaiting.find((x) => x.code === c); V.confirm(`Approve <em>${c}?</em>`, `${money(p.amountCents)} to the organizer of ${esc(p.event)} on ${p.date}. This records your decision and prepares the bank file.`, 'Approve', () => {
        K.run(() => API.post(`/super/payouts/${c}/approve`, {}, { idem: API.key() }), null, () => load('payouts', 'audit', 'overview')).then((r) => r && V.modal({ title: `${c} <em>approved</em>`, html: `<p>Upload this bank file to the bank portal. Money moves only when the bank runs it.</p><textarea class="control" readonly style="margin-top:12px;min-height:120px;font:12px/1.5 ui-monospace,monospace">${esc(r.bankFile)}</textarea>`, actions: [{ label: 'Copy', primary: true, onClick: () => { V.copy(r.bankFile, 'Bank file copied'); } }, { label: 'Close' }] })); }); },
      paid: (c) => K.form(`Mark <em>${c}</em> paid`, [{ k: 'ref', l: 'Bank reference' }], 'Mark Paid', (f) => { K.run(() => API.post(`/super/payouts/${c}/mark-paid`, { bankRef: f.ref }, { idem: API.key() }), `${c} marked paid.`, () => load('payouts', 'audit')); }) } }; },

fees() { const f = A.fees.bookingFeePercent;
  return { html: K.head('Fees', `The booking fee is <b>${f}%</b>. ${esc(A.fees.example.line)}.`) +
    `<div class="c-grid">${K.card('Booking fee', `<form class="stack" id="feeForm"><label class="field">Percent of the subtotal (0 to 15, in 0.5 steps)<input class="control" id="fee" name="fee" type="number" min="0" max="15" step="0.5" value="${f}" required style="max-width:160px"></label>
      <div class="invoice" aria-live="polite"><div class="row"><span>1 × Phase 3</span><b>LKR 9,000</b></div><div class="row"><span>Booking fee (<span id="exPct">${f}</span>%)</span><b id="exFee"></b></div><hr><div class="row"><b>Fan pays</b><b id="exTot"></b></div></div><button class="btn btn-primary btn-sm" style="justify-self:start">Save Fee</button></form>`, { span: 's6', foot: 'Saving applies to fan checkout straight away. Orders already placed keep their fee.' })}
    ${K.card('Charges not set here', `<ul class="alerts">${A.fees.notSetHere.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ul>`, { span: 's6' })}</div>`,
    wire: (root) => { const i = $('#fee', root), ex = () => { const v = +i.value || 0, fee = Math.round(9000 * v / 100); $('#exPct').textContent = v; $('#exFee').textContent = V.money(fee); $('#exTot').textContent = V.money(9000 + fee); }; i.oninput = ex; ex();
      $('#feeForm', root).onsubmit = (ev) => { ev.preventDefault(); const v = +i.value; K.run(() => API.patch('/super/settings/fees', { bookingFeePercent: v }), `Booking fee is now ${v}%. Fan checkout has changed.`, () => load('fees', 'overview', 'audit')); }; } }; },

users() { const us = A.users.items || [];
  return { html: K.head('Users', `<b>${n(A.users.total)} fan accounts</b>.`) + K.table('Fan accounts', [{ k: 'n', l: 'Name' }, { k: 'e', l: 'Email' }, { k: 'o', l: 'Orders', r: 1 }, { k: 'j', l: 'Joined' }], us.map((x) => ({ n: `<span style="display:inline-flex;gap:8px;align-items:center"><span class="av">${V.initials(x.name)}</span>${esc(x.name)}</span>`, e: esc(x.email), o: x.orders, j: x.joined })))
    + ((A.privacy.items || []).length ? K.table('Privacy requests', [{ k: 'k', l: 'Request' }, { k: 'e', l: 'Email' }, { k: 'd', l: 'Answer by' }, { k: 's', l: 'Status' }, { k: 'a', l: '', r: 1 }], A.privacy.items.map((r) => ({ k: cap(r.kind), e: esc(r.email), d: r.due, s: K.pill(cap(r.status)), a: r.status === 'done' ? '' : K.link('Mark done', 'pdone', r.id) })), { search: false }) : ''),
    acts: { pdone: (id) => K.run(() => API.patch(`/super/privacy/requests/${id}`, { status: 'done' }), 'Request closed.', () => load('privacy')) } }; },

audit() { const a = A.audit.items || [];
  return { html: K.head('Audit log', `<b>${n(A.audit.total)} decisions</b> on record, newest first.`, K.btn('Export CSV', 'csv')) + K.table('Every decision', [{ k: 't', l: 'Time' }, { k: 'w', l: 'Who' }, { k: 'a', l: 'Action' }, { k: 'x', l: 'Target' }, { k: 'r', l: 'Result' }], a.map((x) => ({ t: when(x.at), w: esc(x.who), a: esc(x.action), x: esc(x.target), r: K.pill(x.result) }))),
    acts: { csv: () => K.csvFrom('VOID audit log', '/super/audit.csv') } }; },

prefs() { const s = A.settings, r = s.rules;
  return { crumb: 'Settings', html: K.head('Settings', 'Currency and time zone are <b>locked</b> to LKR and Asia/Colombo.') +
    `<div class="c-grid">${K.card('Platform', `<form class="stack" id="pf"><div class="formgrid"><label class="field">Platform name<input class="control" name="platformName" value="${esc(s.platformName)}" required></label><label class="field">Support email<input class="control" name="supportEmail" type="email" value="${esc(s.supportEmail)}" required></label><label class="field">Currency<input class="control" value="${esc(s.currency)}" disabled title="Locked"></label><label class="field">Time zone<input class="control" value="${esc(s.timeZone)}" disabled title="Locked"></label></div><label class="field">Data protection contact<input class="control" name="dataProtectionContact" value="${esc(s.dataProtectionContact)}"></label><button class="btn btn-primary btn-sm" style="justify-self:start">Save</button></form>`, { span: 's7' })}
    ${K.card('Booking rules', `<ul class="alerts"><li><span>Split hold</span><b>${r.splitHoldHours} hours</b></li><li><span>Seat hold</span><b>${r.seatHoldMinutes} minutes</b></li><li><span>Koko</span><b>${r.kokoInstalments} instalments</b></li><li><span>Admins</span><b>One event per admin</b></li><li><span>Layouts</span><b>Need super admin review</b></li><li><span>Booking fee</span><b>${r.bookingFeePercent}%</b></li></ul>`, { span: 's5' })}
    ${K.card('Retention (PDPA)', `<ul class="alerts"><li><span>Notify lists</span><b>${s.retention.notifyListDays} days after the event</b></li><li><span>Guest mobile numbers</span><b>${s.retention.guestContactDays} days</b></li><li><span>Scanner device ids</span><b>${s.retention.scanDeviceDays} days</b></li><li><span>Unsubscribed emails</span><b>${s.retention.unsubscribedDays} days</b></li></ul>`, { foot: 'A nightly job applies these.' })}</div>`,
    wire: (root) => { $('#pf', root).onsubmit = (ev) => { ev.preventDefault(); K.run(() => API.patch('/super/settings', Object.fromEntries(new FormData(ev.target))), 'Settings saved.', () => load('settings')); }; } }; },
};
for (const [k, fn] of Object.entries(screens)) screens[k] = (arg) => { try { return fn(arg); } catch (e) { console.error(e); return { html: K.head('Something went wrong', esc(e.message)) }; } };

K.mount({ role: 'super', scope: ['Platform workspace', 'Every event and organizer'], badge: 'All events', rule: 'You see every event. Every decision you make is written to the audit log.', person: [u.name, 'Platform owner'], screens,
  top: '<form id="topSearch" role="search"><label class="sr-only" for="ts" style="position:absolute;width:1px;height:1px;overflow:hidden">Search events</label><input class="control" id="ts" type="search" placeholder="Search events"></form>',
  nav: [['overview', 'Overview'], ['events', 'Events', () => A.events.inReview], ['admins', 'Admins'], ['venues', 'Venues', () => A.overview.decisions?.layoutsToReview], ['revenue', 'Revenue'], ['payouts', 'Payouts', () => A.payouts.finding?.batches], ['fees', 'Fees'], ['users', 'Users'], ['audit', 'Audit log'], ['prefs', 'Settings']] });
$('#topSearch').onsubmit = (ev) => { ev.preventDefault(); sessionStorage.setItem('void.sq', $('#ts').value.trim()); K.go('events'); };
})();
