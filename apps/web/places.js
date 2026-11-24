/* VOID · places.js: the three pages that hold 3D scenes. venue.html, tables.html, venues.html. */
(() => {
const { $, esc, money } = V, page = document.body.dataset.page, main = $('#main');
V.chrome(page === 'venues' ? 'venues' : 'events');
const ctx = V.ctx(), e = V.event(ctx.e);
const back = (to) => { const b = V.store.get('back', null); V.store.set('scrollTo', to || (b && b.e === e.id ? { y: b.y } : { id: 'venue' })); location.href = `event.html#e${e.id}`; };
const backBtn = `<button class="btn btn-line btn-sm" id="back">${V.icon('back')} Back to Event</button>`;

if (page === 'venue') {
  document.title = `${e.venue} in 3D · VOID`;
  main.innerHTML = `<section class="page-top"><div class="wrap">${backBtn}
    <p class="eyebrow" style="margin-top:24px">${V.icon('cube')} 3D venue view · ${esc(e.name)}</p><h1 class="h-section" style="margin:12px 0 24px">See ${esc(e.venue)} <em>before you arrive</em></h1>
    <div class="v3d" id="scene"></div><div class="areas" id="areas" role="group" aria-label="Jump to an area"></div><div class="info" id="info" aria-live="polite"></div>
    <p class="note" style="margin-top:14px">${e.model ? 'Fly gives you the whole grounds from above. Walk puts you at Gate 02 at eye height.' : `The 3D model of ${esc(e.venue)} is on the way. This is the flat layout.`}</p></div></section>`;
  V3D.venue($('#scene'), { name: e.venue, model: !!e.model, chips: $('#areas'), info: $('#info') });
  $('#back').onclick = () => back();
}

if (page === 'tables') {
  const tier = ctx.tier; document.title = `VIP table map · ${e.name} · VOID`;
  if (!tier || !e.hasVip) {
    main.innerHTML = `<section class="page-top"><div class="wrap"><div class="co-lock" style="margin-top:40px"><p class="eyebrow">VIP table map</p><h1 class="h-section" style="font-size:clamp(34px,4vw,56px);margin:12px 0">Tables are for <em>VIP tiers</em></h1><p>Pick Gold or Platinum on the event page and the map opens for that tier.</p><p style="margin-top:20px"><button class="btn btn-primary" id="back">Choose a VIP Tier</button></p></div></div></section>`;
    $('#back').onclick = () => { V.store.set('ctx', { e: 0 }); V.store.set('scrollTo', { id: 'vip' }); location.href = 'event.html#e0'; };
  } else {
    const v = V.VIP[tier]; let pick = null;
    main.innerHTML = `<section class="page-top"><div class="wrap">${backBtn}
      <p class="eyebrow" style="margin-top:24px">${V.icon('cube')} VIP table map · ${v.name}</p><h1 class="h-section" style="margin:12px 0 24px">Choose your <em>table</em></h1>
      <div class="tmap"><div><div class="v3d" id="scene" role="application" aria-label="3D map of the VIP tables. Use List View for a keyboard-friendly list."></div>
        <p class="legend"><span><i></i>Available</span><span><i class="l-sel"></i>Selected</span><span><i class="l-held"></i>Held</span><span><i class="l-res"></i>Reserved</span><span><i class="l-lock"></i>${tier === 'gold' ? 'Platinum' : 'Gold'} only</span></p></div>
        <aside class="card side" id="side" aria-live="polite"></aside></div></div></section>`;
    const side = () => { $('#side').innerHTML = `<p class="eyebrow">Your spot for the night</p><h2 class="h-card" style="font-size:30px;margin:10px 0 0">${pick ? pick.id : 'No table yet'}</h2>
      <dl><dt>Tier</dt><dd>${v.name}</dd><dt>Seats</dt><dd>Up to ${v.seats}</dd><dt>Minimum spend</dt><dd>${money(v.price)}</dd><dt>Free tables</dt><dd>${V.freeTables(tier)} of 8</dd></dl>
      <button class="btn btn-primary btn-wide" id="reserve" ${pick ? '' : 'disabled title="Select a table on the map first"'}>Reserve This Table</button><p class="note" style="margin-top:10px">${pick ? 'We hold it for 9 min 41 s while you pay.' : 'Select a glowing table on the map, or use List View.'}</p>`;
      $('#reserve').onclick = async () => { const b = $('#reserve'); b.disabled = true;
        try { const old = V.store.get('sel', null); if (old?.holdId) await API.del(`/holds/${old.holdId}`, { headers: { 'X-Hold-Secret': old.secret } }).catch(() => null);
          const h = await API.post('/holds', { kind: 'table', eventId: e.slug, tableCode: pick.id, vipTier: tier }, { idem: API.key() });
          V.store.set('sel', { e: e.id, kind: 'table', table: pick.id, tierKey: tier, qty: 1, unit: h.unitCents / 100, split: false, group: 4, label: h.label, until: Date.parse(h.displayExpiresAt), holdId: h.id, secret: h.secret }); back({ id: 'checkout' }); }
        catch (err) { V.toast(err.message); b.disabled = false; } }; };
    V3D.tables($('#scene'), { tables: V.tables(), tier, onSelect: (t) => { pick = t; side(); V.toast(`${t.id} selected.`); } });
    side(); $('#back').onclick = () => back({ id: 'vip' });
  }
}

if (page === 'venues') {
  const ST = { ready: 'Ready', 'in review': 'In review', none: 'None' };
  const VEN = (BOOT.venues || []).filter((v) => v.event).slice(0, 4).map((v) => [v.name, v.city, v.capacity, v.event.legacyId, ST[v.modelStatus] || 'None']);
  main.innerHTML = `<section class="page-top"><div class="wrap"><p class="eyebrow">Venues</p><h1 class="h-hero" style="margin:14px 0 36px">Spaces worth <em>showing up for.</em></h1>
    <div class="venue-cards">${VEN.map(([n, c, cap, id, st]) => `<article class="card reveal"><p class="eyebrow">${c}</p><h2 class="h-card">${n}</h2><b>${cap.toLocaleString('en-US')}</b><p class="small muted">capacity · hosts ${esc(V.event(id).name)}</p>
      <p><span class="pill ${st === 'Ready' ? 'pill-ok">3D model. Ready' : st === 'In review' ? 'pill-warn">3D model. In review' : 'pill-idle">Venue layout'}</span></p><a class="btn btn-line btn-sm" href="venue.html#e${id}" style="justify-self:start">Explore Venue</a></article>`).join('')}</div>
    <div class="head"><div><p class="eyebrow">${V.icon('cube')} Featured · Lotus Tower, Colombo</p><h2 class="h-section">Reach into the room <em>before you're in it.</em></h2></div></div>
    <div class="v3d" id="scene"></div><div class="areas" id="areas" role="group" aria-label="Jump to an area"></div><div class="info" id="info" aria-live="polite"></div></div></section>`;
  V3D.venue($('#scene'), { name: 'Lotus Tower', model: true, chips: $('#areas'), info: $('#info') });
  V.reveal();
}
})();
