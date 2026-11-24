/* VOID · console.js: the shell and building blocks shared by the organizer and platform consoles, plus the chart kit. */
(() => {
const { $, $$, esc } = V;
const K = window.K = {};
const WORDS = { ok: ['paid', 'live', 'admitted', 'on sale', 'approved', 'active', 'online', 'ready', 'completed', 'published', 'selling fast', 'operational'], warn: ['split pending', 'in review', 'held', 'scheduled', 'awaiting', 'pending', 'due today', 'draft saved', 'up next', 'registering interest', 'changes requested', 'pending approval'], bad: ['suspended', 'refunded', 'blocked', 'rejected', 'released', 'failed', 'overdue', 'sales paused', 'duplicate'] };
K.pill = (t) => { const s = String(t).toLowerCase(), k = Object.keys(WORDS).find((c) => WORDS[c].some((w) => s.startsWith(w))) || 'idle'; return `<span class="pill pill-${k}">${esc(t)}</span>`; };
K.kpis = (list) => `<div class="kpis">${list.map(([l, v, n]) => `<div class="kpi"><p class="kpi-label">${l}</p><p class="kpi-value">${v}</p><p class="kpi-note">${n || ''}</p></div>`).join('')}</div>`;
K.card = (title, body, o = {}) => `<section class="c-card ${o.span || ''}"${o.id ? ` id="${o.id}"` : ''}><header><strong>${title}</strong>${o.head || ''}</header>${o.flush ? body : `<div class="c-body">${body}</div>`}${o.foot ? `<footer>${o.foot}</footer>` : ''}</section>`;
K.head = (title, finding, actions = '') => `<div class="c-head"><div><h1 class="c-title">${title}</h1><p class="finding">${finding}</p></div><div class="tools">${actions}</div></div>`;
/* A data table: right-aligned numbers, an action column, a search box and a status filter that narrow rows and print "Showing N of M". */
K.table = (title, cols, rows, o = {}) => { const id = o.id || 't' + Math.random().toString(36).slice(2, 7);
  const tools = `<div class="tools">${o.search !== false ? `<input class="control" type="search" placeholder="Search" aria-label="Search ${esc(title)}" data-tsearch="${id}">` : ''}${o.filter ? `<select class="control" aria-label="Filter by status" data-tfilter="${id}"><option value="">All statuses</option>${o.filter.map((f) => `<option>${f}</option>`).join('')}</select>` : ''}${o.tools || ''}<span data-tcount="${id}">Showing ${rows.length} of ${rows.length}</span></div>`;
  const body = `<div class="table-wrap"><table class="table" id="${id}"><thead><tr>${cols.map((c) => `<th${c.r ? ' class="r"' : ''}>${c.l}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr data-status="${esc(r._status || '')}"${r._click ? ` data-go="${r._click}" style="cursor:pointer"` : ''}>${cols.map((c) => `<td${c.r ? ' class="r"' : ''}>${r[c.k] ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" style="text-align:center;padding:28px">${o.empty || 'Nothing here yet.'}</td></tr>`}</tbody></table></div>`;
  return K.card(title, body, { ...o, flush: true, head: tools }); };
K.bars = (items, o = {}) => { const max = o.max || Math.max(...items.map((i) => i[1]), 1); return items.map(([l, v, shown], i) => `<div class="barrow"><span>${l}</span><div class="meter${i && !o.all ? ' dim' : ''}"><i style="width:${Math.max(1, v / max * 100)}%"></i></div><b>${shown ?? v.toLocaleString('en-US')}</b></div>`).join(''); };
K.btn = (label, act, o = {}) => `<button type="button" class="btn ${o.primary ? 'btn-primary' : 'btn-line'} btn-sm" data-act="${act}"${o.arg != null ? ` data-arg="${esc(o.arg)}"` : ''}${o.off ? ` disabled title="${esc(o.off)}"` : ''}>${label}</button>`;
K.link = (label, act, arg) => `<button type="button" class="link" data-act="${act}" data-arg="${esc(arg ?? '')}">${label}</button>`;
K.toggle = (label, act, on) => `<label class="switch"><input type="checkbox" data-act="${act}" ${on ? 'checked' : ''}>${label}</label>`;
/* Downloads are blocked inside the page frame, so an export opens the file's text with a Copy button. */
K.csv = (name, rows) => { const text = rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\n');
  V.modal({ title: esc(name), html: `<p>${rows.length - 1} rows. Copy this and paste it into a sheet, or save it as a .csv file.</p><textarea class="control" readonly style="margin-top:12px;min-height:200px;font:12px/1.5 ui-monospace,monospace">${esc(text)}</textarea>`, actions: [{ label: 'Copy CSV', primary: true, onClick: () => { V.copy(text, 'CSV copied'); } }, { label: 'Close' }] }); };
K.form = (title, fields, label, fn) => V.modal({ title, html: `<form class="stack" id="kf">${fields.map((f) => `<label class="field">${f.l}${f.options ? `<select class="control" name="${f.k}">${f.options.map((x) => `<option>${x}</option>`).join('')}</select>` : `<input class="control" name="${f.k}" type="${f.t || 'text'}" ${f.req === false ? '' : 'required'} ${f.attr || ''} value="${esc(f.v ?? '')}">`}</label>`).join('')}<button class="btn btn-primary btn-wide">${label}</button></form>`,
  onOpen: (d) => $('#kf', d).onsubmit = (e) => { e.preventDefault(); if (fn(Object.fromEntries(new FormData(e.target))) !== false) d.close(); } });

/* ---------- Charts: small SVG, one accent series in ink, the rest faint, quiet gridlines, a written label ---------- */
const C = K.charts = {};
C.bars = (data, o = {}) => { const Wd = 640, H = 220, pl = 44, pb = 28, pt = 26, max = Math.max(...data.map((d) => d.v)) * 1.15, bw = (Wd - pl - 10) / data.length, y = (v) => pt + (H - pt - pb) * (1 - v / max), f = o.fmt || ((v) => v.toLocaleString('en-US'));
  const grid = [0, .25, .5, .75, 1].map((g) => `<line x1="${pl}" x2="${Wd - 6}" y1="${y(max * g / 1.15)}" y2="${y(max * g / 1.15)}" stroke="rgba(255,255,255,.1)"/><text x="${pl - 6}" y="${y(max * g / 1.15) + 4}" text-anchor="end">${f(Math.round(max * g / 1.15))}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${esc(o.label || '')}" style="width:100%">${grid}${data.map((d, i) => { const x = pl + i * bw + bw * .18, w = bw * .64; return `<rect x="${x}" y="${y(d.v)}" width="${w}" height="${Math.max(0, H - pb - y(d.v))}" rx="4" fill="${d.accent ? '#f2f2f2' : '#9a9a9a'}" ${d.partial ? 'fill-opacity=".45" stroke="#f2f2f2" stroke-dasharray="3 3"' : ''}/><text x="${x + w / 2}" y="${H - 9}" text-anchor="middle">${d.l}</text><text class="v" x="${x + w / 2}" y="${y(d.v) - 6}" text-anchor="middle">${f(d.v)}</text>${d.note ? `<text x="${x + w / 2}" y="${12}" text-anchor="middle" fill="#f2f2f2" style="fill:#c9c9c9">${d.note}</text><line x1="${x + w / 2}" x2="${x + w / 2}" y1="16" y2="${y(d.v) - 18}" stroke="rgba(255,255,255,.3)" stroke-dasharray="2 3"/>` : ''}`; }).join('')}</svg>`; };
C.line = (pts, o = {}) => { const Wd = 640, H = 220, pl = 48, pb = 28, pt = 16, all = pts.concat(o.proj || []), max = Math.max(o.target || 0, ...all.map((p) => p.v)) * 1.08, x = (i) => pl + i * (Wd - pl - 16) / (all.length - 1), y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const path = (arr, off) => arr.map((p, i) => `${i ? 'L' : 'M'}${x(i + off)} ${y(p.v)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${esc(o.label || '')}" style="width:100%">${[0, .5, 1].map((g) => `<line x1="${pl}" x2="${Wd - 6}" y1="${y(max * g / 1.08)}" y2="${y(max * g / 1.08)}" stroke="rgba(255,255,255,.1)"/><text x="${pl - 6}" y="${y(max * g / 1.08) + 4}" text-anchor="end">${Math.round(max * g / 1.08).toLocaleString('en-US')}</text>`).join('')}
    ${o.target ? `<line x1="${pl}" x2="${Wd - 6}" y1="${y(o.target)}" y2="${y(o.target)}" stroke="#9a9a9a" stroke-dasharray="6 4"/><text x="${Wd - 8}" y="${y(o.target) - 6}" text-anchor="end">${o.targetLabel}</text>` : ''}
    <path d="${path(pts, 0)}" fill="none" stroke="#f2f2f2" stroke-width="2.5" stroke-linejoin="round"/>${o.proj ? `<path d="M${x(pts.length - 1)} ${y(pts[pts.length - 1].v)} ${o.proj.map((p, i) => `L${x(pts.length + i)} ${y(p.v)}`).join(' ')}" fill="none" stroke="#f2f2f2" stroke-width="2" stroke-dasharray="5 5"/>` : ''}
    <line x1="${x(pts.length - 1)}" x2="${x(pts.length - 1)}" y1="${pt}" y2="${H - pb}" stroke="rgba(255,255,255,.35)"/><text x="${x(pts.length - 1) - 6}" y="${pt + 10}" text-anchor="end" style="fill:#c9c9c9">today</text>
    <circle cx="${x(pts.length - 1)}" cy="${y(pts[pts.length - 1].v)}" r="4.5" fill="#fff"/><text class="v" x="${x(pts.length - 1) - 8}" y="${y(pts[pts.length - 1].v) - 8}" text-anchor="end">${pts[pts.length - 1].v.toLocaleString('en-US')}</text>
    ${all.map((p, i) => `<text x="${x(i)}" y="${H - 9}" text-anchor="middle">${p.l}</text>`).join('')}</svg>`; };

/* CSV straight from the API (it builds the file with the same columns the console shows). */
K.csvFrom = async (name, path) => { try { const text = await API.text(path); V.modal({ title: esc(name), html: `<p>${text.trim().split('\n').length - 1} rows. Copy this and paste it into a sheet, or save it as a .csv file.</p><textarea class="control" readonly style="margin-top:12px;min-height:200px;font:12px/1.5 ui-monospace,monospace">${esc(text)}</textarea>`, actions: [{ label: 'Copy CSV', primary: true, onClick: () => { V.copy(text, 'CSV copied'); } }, { label: 'Close' }] }); } catch (e) { V.toast(e.message); } };
/** Runs an API call, toasts the outcome, and reloads the named slices before re-rendering. */
K.run = async (fn, ok, reload) => { try { const r = await fn(); if (reload) await reload(); if (ok) V.toast(typeof ok === 'function' ? ok(r) : ok); K.refresh(); return r; } catch (e) { V.toast(e.message); return null; } };

/* ---------- Sign-in gate: the consoles need a staff account ---------- */
K.gate = (roles, title) => new Promise((resolve) => {
  const u = API.user();
  if (u && roles.includes(u.role)) return resolve(u);
  let otp = false;
  const draw = (msg = '') => { document.body.classList.add('console');
    document.body.innerHTML = `<main class="canvas" style="max-width:440px;margin:10vh auto;padding:24px"><a href="index.html" aria-label="VOID home">${V.lockup('sm')}</a>
      <h1 class="c-title" style="margin-top:28px">${title}</h1><p class="finding">${u ? `You're signed in as <b>${esc(u.name)}</b>, which can't open this workspace.` : 'Sign in with your staff account.'}</p>
      <form class="stack" id="gf" style="margin-top:18px"><label class="field">Email<input class="control" name="email" type="email" required autocomplete="username"></label><label class="field">Password<input class="control" name="password" type="password" required autocomplete="current-password"></label>
      ${otp ? '<label class="field">Authenticator code<input class="control" name="otp" inputmode="numeric" pattern="[0-9]{6}" required autocomplete="one-time-code"></label>' : ''}<button class="btn btn-primary btn-wide">Sign In</button><p class="note" role="alert">${esc(msg)}</p></form>
      ${V.DEMO ? '<p class="note" style="margin-top:18px">Demo accounts use the password <b>Void-demo-2027</b>: nimal.perera@organizers.example.com (organizer), chamara.fonseka@staff.example.com (gate), super@eventsbythevoid.lk (platform).</p>' : ''}
      <p style="margin-top:14px"><a class="link" href="index.html">Back to the site</a></p></main>`;
    document.getElementById('gf').onsubmit = async (ev) => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
      try { const r = await API.login({ email: f.email, password: f.password, ...(f.otp ? { otp: f.otp } : {}) }); if (!roles.includes(r.user.role)) return draw('That account can’t open this workspace.'); location.reload(); }
      catch (e) { if (e.code === 'MFA_CODE_REQUIRED') { otp = true; draw(); return; } draw(e.message); } }; };
  draw();
});
K.signOut = async () => { await API.logout(); location.reload(); };

/* ---------- Shell ---------- */
K.mount = (cfg) => { document.body.classList.add('console');
  document.body.innerHTML = `<a class="skip" href="#canvas" style="position:fixed;left:16px;top:-60px;z-index:60;background:#fff;color:#000;padding:10px 16px;border-radius:8px">Skip to content</a>
  <aside class="side-nav" id="sideNav"><a href="index.html" aria-label="VOID home">${V.lockup('sm')}</a><div class="scope"><b>${cfg.scope[0]}</b>${cfg.scope[1]}</div>
    <nav aria-label="${cfg.scope[0]}" id="cnav"></nav><p class="rule">${cfg.rule}</p><div class="who"><span class="av">${V.initials(cfg.person[0])}</span><span>${cfg.person[0]}<small>${cfg.person[1]} · <button type="button" class="link" id="signOut" style="min-height:0;font-size:inherit">Sign out</button></small></span></div>
    ${V.DEMO ? `<div class="switcher" aria-label="Demo workspaces"><a href="index.html">Client</a><a href="admin.html"${cfg.role === 'admin' ? ' aria-current="true"' : ''}>Admin</a><a href="super.html"${cfg.role === 'super' ? ' aria-current="true"' : ''}>Super</a></div>` : ''}</aside>
  <div class="c-main"><div class="topbar"><button class="icon-btn menu-btn" id="menuBtn" aria-label="Menu" aria-expanded="false">${V.icon('menu')}</button><span class="grow" id="crumb"></span>${cfg.top || ''}<span class="pill pill-idle">${cfg.badge}</span></div><main class="canvas" id="canvas" tabindex="-1"></main></div>`;
  const canvas = $('#canvas'); let acts = {}, cur = '';
  $('#signOut').onclick = K.signOut;
  const drawer = (on) => { document.body.classList.toggle('drawer', on); $('#menuBtn').setAttribute('aria-expanded', on); };
  $('#menuBtn').onclick = () => drawer(!document.body.classList.contains('drawer'));
  addEventListener('keydown', (e) => e.key === 'Escape' && drawer(false));
  const nav = () => { $('#cnav').innerHTML = cfg.nav.map(([id, label, badge]) => { const b = typeof badge === 'function' ? badge() : badge; return `<a href="#${id}"${id === cur.split('-')[0] || id === cur ? ' aria-current="page"' : ''}>${label}${b ? `<span class="badge">${b}</span>` : ''}</a>`; }).join(''); };
  const render = (keep) => { const y = scrollY, fid = document.activeElement?.id, route = (location.hash.slice(1) || cfg.nav[0][0]), [base, arg] = route.split(/-(?=[a-f\d]{24}$|\d+$)/), fn = cfg.screens[base] || cfg.screens[cfg.nav[0][0]];
    cur = cfg.screens[base] ? route : cfg.nav[0][0]; acts = {}; const out = fn(arg);
    canvas.innerHTML = out.html; out.acts && (acts = out.acts); nav(); $('#crumb').textContent = `${cfg.scope[0]} / ${out.crumb || (cfg.nav.find((n) => n[0] === base) || cfg.nav[0])[1]}`;
    out.wire && out.wire(canvas); if (keep) { scrollTo(0, y); fid && document.getElementById(fid)?.focus(); } else { scrollTo(0, 0); canvas.focus({ preventScroll: true }); } };
  K.refresh = () => render(true); K.go = (r) => { if (location.hash === '#' + r) render(); else location.hash = r; };
  addEventListener('hashchange', () => { drawer(false); render(); });
  $('#cnav').addEventListener('click', () => drawer(false));
  canvas.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && b.type !== 'checkbox' && acts[b.dataset.act]) { e.stopPropagation(); return acts[b.dataset.act](b.dataset.arg, b); } const r = e.target.closest('tr[data-go]'); if (r && !e.target.closest('button,a')) K.go(r.dataset.go); });
  canvas.addEventListener('change', (e) => { const b = e.target.closest('input[type=checkbox][data-act]'); if (b && acts[b.dataset.act]) acts[b.dataset.act](b.checked, b); });
  canvas.addEventListener('input', (e) => { const s = e.target.closest('[data-tsearch],[data-tfilter]'); if (!s) return; const id = s.dataset.tsearch || s.dataset.tfilter, q = ($(`[data-tsearch="${id}"]`)?.value || '').toLowerCase(), f = $(`[data-tfilter="${id}"]`)?.value || '';
    const rows = $$(`#${id} tbody tr`); let n = 0; rows.forEach((r) => { const ok = (!q || r.textContent.toLowerCase().includes(q)) && (!f || r.dataset.status === f); r.hidden = !ok; n += ok; }); $(`[data-tcount="${id}"]`).textContent = `Showing ${n} of ${rows.length}`; });
  render(); };
})();
