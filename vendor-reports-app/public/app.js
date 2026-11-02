// Vendor Reporting Centre — frontend.
//
// Laid out to match the Job Manager app so the two read as one product:
// a searchable card grid with pill tabs, drilling into a vendor's homes as
// cards, then into the exportable report. Nothing is generated here; every
// value comes from the board data the backend computed.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const icon = (n, cls = 'i') => `<svg class="${cls}"><use href="#ic-${n}"/></svg>`;

  const STATE = {
    complete: { label: 'Complete', pill: 'good' },
    active:   { label: 'On track', pill: '' },
    stalled:  { label: 'Stalled',  pill: 'crit' },
    unscoped: { label: 'Not scoped', pill: 'warn' },
  };

  let DATA = null;
  let current = null;          // selected vendor on the detail screen
  let range = 'this-week';
  let tab = 'all';             // vendor grid filter
  let homeTab = 'all';         // home filter inside a vendor
  let sort = 'attention';
  let query = '';

  // ---- talking to our backend --------------------------------------------
  async function sessionToken() {
    if (!window.mondaySdk) return null;
    try {
      const monday = window.mondaySdk();
      const res = await monday.get('sessionToken');
      return res?.data || null;
    } catch { return null; }
  }

  async function api(path, options = {}) {
    const token = await sessionToken();
    const res = await fetch(path, {
      ...options,
      headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (res.status === 401) {
      throw new Error('This app has to be opened from inside monday.com — that is where it gets permission to read your boards.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  // ---- derived facts (all from board data, nothing invented) --------------
  const period = () => DATA.ranges.find((r) => r.key === range) || DATA.ranges[0];

  const dayNum = (ymd) => (ymd ? Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 864e5 : null);

  function agoLabel(ymd) {
    const a = dayNum(ymd); const b = dayNum(DATA.today);
    if (a == null || b == null) return null;
    const n = b - a;
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    return `${n}d ago`;
  }

  /** Everything the vendor grid needs, computed once per render. */
  function vendorFacts(v) {
    const rep = v.reports[range];
    const jobs = rep.jobs;
    const live = jobs.filter((j) => j.state !== 'unscoped');
    const hasEmail = (v.recipients || []).length > 0;
    const sendable = live.length > 0;

    const done = live.reduce((n, j) => n + j.progress.done, 0);
    const total = live.reduce((n, j) => n + j.progress.total, 0);

    // soonest booked work across this vendor's homes, with the phase name
    let next = null;
    for (const j of jobs) {
      for (const p of j.pending) {
        if (p.date && (!next || p.date < next.date)) next = { date: p.date, name: p.name, home: j.name };
      }
    }

    const stalled = rep.counts.stalled || 0;
    const unscoped = rep.counts.unscoped || 0;
    const sentInPeriod = Boolean(v.lastSent && period().start && v.lastSent >= period().start);

    return {
      rep, jobs, hasEmail, sendable, stalled, unscoped, next, sentInPeriod,
      completed: rep.completedCount,
      progress: { done, total, pct: total ? Math.round((done / total) * 100) : 0 },
      attention: !hasEmail || stalled > 0 || unscoped > 0,
      ready: hasEmail && sendable,
    };
  }

  const TABS = [
    { key: 'all',       label: 'All Vendors',    test: () => true },
    { key: 'ready',     label: 'Ready to Send',  test: (f) => f.ready && !f.sentInPeriod },
    { key: 'attention', label: 'Needs Attention', test: (f) => f.attention },
    { key: 'sent',      label: 'Sent This Period', test: (f) => f.sentInPeriod },
  ];

  function matchesQuery(v) {
    if (!query) return true;
    const hay = [v.name, ...(v.recipients || []),
      ...v.reports[range].jobs.flatMap((j) => [j.name, j.address])].join(' ').toLowerCase();
    return hay.includes(query);
  }

  // ---- vendor grid --------------------------------------------------------
  function vendorCard(v, f) {
    const pill = !f.hasEmail ? '<span class="pill crit">No email</span>'
      : !f.sendable ? '<span class="pill grey">Nothing to report</span>'
      : f.sentInPeriod ? '<span class="pill good">Sent</span>'
      : '<span class="pill">Ready to send</span>';
    const extra = f.stalled ? `<span class="pill crit">${f.stalled} stalled</span>` : '';

    const mail = f.hasEmail
      ? `<p class="meta">${icon('mail')}<span>${esc(v.recipients.join('; '))}</span></p>`
      : `<p class="meta bad">${icon('mail')}<span>No Status Update Email on the board</span></p>`;

    const next = f.next
      ? `<div class="card-div"><p class="meta" style="margin:0">${icon('cal')}<span>
           <span class="next-l">Next: ${esc(f.next.name)}</span>
           <span class="next-s"> &middot; ${esc(f.next.home)} &middot; ${esc(dateLabel(f.next.date))}</span></span></p></div>`
      : '';

    const sent = v.lastSent
      ? `Report sent ${esc(agoLabel(v.lastSent))}${v.lastSentLabel ? ` &middot; ${esc(v.lastSentLabel)}` : ''}`
      : 'No report sent yet';

    return `<button class="card" data-vendor="${esc(v.id)}">
      <div class="card-top">
        <span class="card-name">${esc(v.name)}</span>
        <span class="chev" aria-hidden="true">${icon('chev-r')}</span>
      </div>
      <div class="card-pills">${pill}${extra}</div>
      ${mail}
      <p class="meta">${icon('home')}<span>${plural(v.homes, 'home')} &middot; ${plural(f.completed, 'task')} finished this period</span></p>
      ${f.sendable ? `
      <div class="prog-head"><span>Progress</span><span>${f.progress.done}/${f.progress.total} phases</span></div>
      <div class="bar${f.progress.pct >= 100 ? ' full' : ''}"><i style="width:${f.progress.pct}%"></i></div>` : ''}
      ${next}
      <div class="card-div card-foot">${icon('clock')}<span>${sent}</span></div>
    </button>`;
  }

  function dateLabel(ymd) {
    // the backend already formats the dates it exposes; this is for pending
    // entries, whose label lives in the status string
    const d = new Date(`${ymd}T12:00:00Z`);
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  }

  function renderTabs(facts) {
    $('tabs').innerHTML = TABS.map((t) => {
      const n = DATA.vendors.filter((v) => t.test(facts.get(v.id))).length;
      const badge = t.key === 'attention' && n ? ' badge' : '';
      return `<button class="tab" data-tab="${t.key}" aria-pressed="${t.key === tab}">
        ${t.label}<span class="n${badge}">${n}</span></button>`;
    }).join('');
    $('tabs').querySelectorAll('.tab').forEach((b) => {
      b.onclick = () => { tab = b.dataset.tab; renderVendors(); };
    });
  }

  function renderVendors() {
    const facts = new Map(DATA.vendors.map((v) => [v.id, vendorFacts(v)]));
    renderTabs(facts);

    const t = TABS.find((x) => x.key === tab) || TABS[0];
    let list = DATA.vendors.filter((v) => t.test(facts.get(v.id)) && matchesQuery(v));

    const f = (v) => facts.get(v.id);
    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'homes') return b.homes - a.homes || a.name.localeCompare(b.name);
      if (sort === 'sent') {
        const av = a.lastSent || '0000-00-00'; const bv = b.lastSent || '0000-00-00';
        return av.localeCompare(bv) || a.name.localeCompare(b.name);
      }
      // needs attention first, then most unsent, then name
      const score = (v) => (f(v).attention ? 0 : 1) * 10 + (f(v).sentInPeriod ? 1 : 0);
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });

    $('vendorGrid').innerHTML = list.map((v) => vendorCard(v, f(v))).join('');
    $('vendorGrid').querySelectorAll('[data-vendor]').forEach((el) => {
      el.onclick = () => openVendor(el.dataset.vendor);
    });

    const none = $('vendorNone');
    none.style.display = list.length ? 'none' : '';
    none.textContent = query
      ? `No vendors match “${query}”.`
      : 'No vendors in this view.';
  }

  // ---- vendor detail ------------------------------------------------------
  const escNote = (t) => esc(t).replace(/\r?\n/g, '<br>');
  const noteBlock = (j) => j.note
    ? `<div class="vnote"><span class="vnote-h">A note from Dragon Transports</span>${escNote(j.note)}</div>`
    : '';

  function lists(j, emptyDoneText) {
    const done = j.completed.length
      ? `<div class="grp"><h4 class="done">${emptyDoneText ? 'Completed' : 'Finished this period'}</h4><ul>${
          j.completed.map((c) => `<li><span>${esc(c.name)}</span><em>${esc(c.dateLabel)}</em></li>`).join('')}</ul></div>`
      : `<div class="empty">${emptyDoneText || 'Nothing finished on this home in the selected period.'}</div>`;
    const todo = j.pending.length
      ? `<div class="grp"><h4>Still to do</h4><ul>${
          j.pending.map((p) => `<li><span>${esc(p.name)}</span><em class="${esc(p.tone)}-t">${esc(p.status)}</em></li>`).join('')}</ul></div>`
      : `<div class="empty">All scheduled work on this home is complete.</div>`;
    return done + todo;
  }

  const HOME_TABS = [
    { key: 'all',      label: 'All Homes', test: () => true },
    { key: 'active',   label: 'On Track',  test: (j) => j.state === 'active' },
    { key: 'stalled',  label: 'Stalled',   test: (j) => j.state === 'stalled' },
    { key: 'complete', label: 'Complete',  test: (j) => j.state === 'complete' },
    { key: 'unscoped', label: 'Not Scoped', test: (j) => j.state === 'unscoped' },
  ];

  function homeCard(j) {
    const s = STATE[j.state];
    const body = j.state === 'unscoped'
      ? `<div class="empty">No build phases are marked Yes on this job yet, so there is nothing to report. Set the phase columns in monday and it will fill in.</div>`
      : noteBlock(j) + lists(j);

    const next = j.nextScheduledLabel
      ? `<div class="card-div"><p class="meta" style="margin:0">${icon('cal')}<span class="next-l">Next up ${esc(j.nextScheduledLabel)}</span></p></div>`
      : '';

    return `<article class="card" data-home>
      <div class="card-top">
        <span class="card-name">${esc(j.name)}</span>
        <span class="chev" aria-hidden="true">${icon('chev')}</span>
      </div>
      <div class="card-pills"><span class="pill ${s.pill}">${s.label}</span></div>
      ${j.address ? `<p class="meta">${icon('pin')}<span>${esc(j.address)}</span></p>` : ''}
      ${j.state !== 'unscoped' ? `
      <div class="prog-head"><span>Progress</span><span>${j.progress.done}/${j.progress.total} phases</span></div>
      <div class="bar${j.progress.pct >= 100 ? ' full' : ''}"><i style="width:${Number(j.progress.pct) || 0}%"></i></div>` : ''}
      ${next}
      <div class="card-div card-foot">${icon('clock')}<span>${
        j.lastActivityLabel ? `Last finished ${esc(j.lastActivityLabel)}` : 'Nothing finished yet'}</span></div>
      <div class="home-body">${body}</div>
    </article>`;
  }

  function renderDetail() {
    const f = vendorFacts(current);
    const p = period();

    $('vName').textContent = current.name;
    $('vSub').textContent = [
      f.hasEmail ? current.recipients.join('; ') : 'No Status Update Email on the board',
      plural(current.homes, 'home'),
      current.lastSent ? `report sent ${agoLabel(current.lastSent)}` : 'no report sent yet',
      p.range,
    ].join('  ·  ');

    $('stats').innerHTML = [
      { n: current.homes, l: 'homes', c: '' },
      { n: f.completed, l: 'finished this period', c: f.completed ? 'good' : '' },
      { n: f.stalled, l: 'stalled', c: f.stalled ? 'crit' : '' },
      { n: f.unscoped, l: 'not scoped yet', c: f.unscoped ? 'warn' : '' },
    ].map((s) => `<div class="stat ${s.c}"><b>${s.n}</b><span>${s.l}</span></div>`).join('');

    const jobs = f.jobs;
    $('homeTabs').innerHTML = HOME_TABS.map((t) => {
      const n = jobs.filter(t.test).length;
      return `<button class="subtab" data-htab="${t.key}" aria-pressed="${t.key === homeTab}">
        ${t.label}<span class="n">${n}</span></button>`;
    }).join('');
    $('homeTabs').querySelectorAll('.subtab').forEach((b) => {
      b.onclick = () => { homeTab = b.dataset.htab; renderDetail(); };
    });

    const ht = HOME_TABS.find((x) => x.key === homeTab) || HOME_TABS[0];
    const order = { stalled: 0, unscoped: 1, active: 2, complete: 3 };
    const shown = jobs.filter(ht.test)
      .sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));

    $('homeGrid').innerHTML = shown.map(homeCard).join('');
    $('homeGrid').querySelectorAll('[data-home]').forEach((el) => {
      el.onclick = (e) => { if (!e.target.closest('a')) el.classList.toggle('open'); };
    });
    $('homeNone').style.display = shown.length ? 'none' : '';
    $('homeNone').textContent = 'No homes in this view.';

    $('rLabel').textContent = `${current.name} — ${p.range}`;
  }

  function openVendor(id) {
    current = DATA.vendors.find((v) => String(v.id) === String(id));
    if (!current) return;
    homeTab = 'all';
    renderDetail();
    document.body.dataset.screen = 'detail';
    window.scrollTo(0, 0);
  }

  // ---- the exportable report ---------------------------------------------
  function buildPaper() {
    const rep = current.reports[range];
    const p = period();
    // A home with no phases marked has nothing truthful to say to a customer.
    const shown = rep.jobs.filter((j) => j.state !== 'unscoped');
    const rows = shown.map((j) => `<div class="p-job"><h3>${esc(j.name)}</h3>
        ${j.address ? `<p class="p-addr">${esc(j.address)}</p>` : ''}
        <div class="p-prog"><span class="bar${j.progress.pct >= 100 ? ' full' : ''}"><i style="width:${Number(j.progress.pct) || 0}%"></i></span>
          <span class="frac">${j.progress.done} of ${j.progress.total} steps</span></div>
        ${noteBlock(j)}${lists(j, 'No tasks were completed on this home this period.')}</div>`).join('');

    const c = shown.reduce((a, j) => a + j.completed.length, 0);
    $('paper').innerHTML = `<h2 class="p-title">Progress Report from <span>Dragon Transports</span>!</h2>
      <p class="p-dates">${esc(current.name)} · ${esc(p.range)}</p>
      <p class="p-count"><strong>${plural(shown.length, 'home')}</strong> · ${plural(c, 'task')} completed this period</p>
      ${rows}
      <p class="p-foot">Questions on any home above? Reply to this email and we will get right back to you.</p>`;
  }

  // ---- wiring -------------------------------------------------------------
  function boot(data) {
    DATA = data;
    if (!DATA.vendors.length) {
      $('errMsg').textContent = 'No vendors have jobs linked to them yet. Fill in "Bill to" on the Jobs board and refresh.';
      document.body.className = 'errored';
      return;
    }
    $('range').innerHTML = DATA.ranges.map((r) =>
      `<option value="${esc(r.key)}"${r.key === range ? ' selected' : ''}>${esc(r.label)}</option>`).join('');
    $('stamp').textContent = `Board data as of ${new Date().toLocaleTimeString()}`;
    document.body.className = '';
    if (current) current = DATA.vendors.find((v) => v.id === current.id) || null;
    renderVendors();
    if (current) renderDetail(); else document.body.dataset.screen = 'vendors';
  }

  async function load(refresh = false) {
    document.body.className = 'loading';
    try {
      boot(refresh ? await api('/api/refresh', { method: 'POST' }) : await api('/api/centre'));
    } catch (err) {
      $('errMsg').textContent = err.message;
      document.body.className = 'errored';
    }
  }

  // ---- email: settings dialog --------------------------------------------
  const msg = (id, text, cls) => { const el = $(id); el.textContent = text || ''; el.className = `dlg-msg ${cls || ''}`; };

  async function openSettings() {
    msg('settingsMsg', '');
    $('settingsOverlay').classList.add('open');
    $('settingsStatus').textContent = 'Checking…';
    try {
      const st = await api('/api/settings');
      $('settingsStatus').innerHTML = st.connected
        ? `Currently sending as <b>${esc(st.address)}</b>`
        : 'No sending account connected yet.';
      $('setAddress').value = st.address || '';
    } catch (err) {
      $('settingsStatus').textContent = err.message;
    }
    $('setPassword').value = '';
  }

  $('settingsBtn').onclick = openSettings;
  $('settingsClose').onclick = () => $('settingsOverlay').classList.remove('open');

  $('settingsSave').onclick = async () => {
    msg('settingsMsg', 'Verifying with Gmail…');
    try {
      const st = await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: $('setAddress').value, appPassword: $('setPassword').value }),
      });
      msg('settingsMsg', 'Connected. Gmail accepted the sign-in.', 'ok');
      $('settingsStatus').innerHTML = `Currently sending as <b>${esc(st.address)}</b>`;
      $('setPassword').value = '';
    } catch (err) { msg('settingsMsg', err.message, 'err'); }
  };

  $('settingsTest').onclick = async () => {
    msg('settingsMsg', 'Sending test email…');
    try {
      await api('/api/settings/test', { method: 'POST' });
      msg('settingsMsg', 'Test sent — check the inbox of the sending account.', 'ok');
    } catch (err) { msg('settingsMsg', err.message, 'err'); }
  };

  $('settingsDisconnect').onclick = async () => {
    try {
      await api('/api/settings', { method: 'DELETE' });
      $('settingsStatus').textContent = 'No sending account connected yet.';
      $('setAddress').value = ''; $('setPassword').value = '';
      msg('settingsMsg', 'Disconnected.', 'ok');
    } catch (err) { msg('settingsMsg', err.message, 'err'); }
  };

  // ---- email: send one vendor --------------------------------------------
  const lastRecipients = {};

  function openSendDialog() {
    if (!current) return;
    $('sendTitle').textContent = `Send — ${current.name}`;
    $('sendSub').textContent = `${period().range}. The email is rebuilt from the boards on send; unscoped homes are left out.`;
    $('sendTo').value = lastRecipients[current.id] || (current.recipients || []).join('; ');
    msg('sendMsg', '');
    $('sendOverlay').classList.add('open');
    $('sendTo').focus();
  }
  $('sendBtn').onclick = openSendDialog;
  $('sendReportBtn').onclick = openSendDialog;
  $('sendClose').onclick = () => $('sendOverlay').classList.remove('open');

  $('sendGo').onclick = async () => {
    const btn = $('sendGo');
    btn.disabled = true;
    msg('sendMsg', 'Sending…');
    try {
      const out = await api('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId: current.id, periodKey: range, to: $('sendTo').value }),
      });
      lastRecipients[current.id] = $('sendTo').value;
      msg('sendMsg', `Sent to ${out.to.join(', ')} from ${out.from}.`, 'ok');
      setTimeout(() => { $('sendOverlay').classList.remove('open'); load(); }, 1600);
    } catch (err) { msg('sendMsg', err.message, 'err'); }
    btn.disabled = false;
  };

  // ---- email: send all ----------------------------------------------------
  function sendAllRows() {
    return DATA.vendors.map((v) => {
      const f = vendorFacts(v);
      return { v, f, on: f.ready && !f.sentInPeriod };
    });
  }

  function renderSendAll(rows) {
    $('sendAllList').innerHTML = rows.map(({ v, f, on }) => `
      <label class="sa-row ${f.ready ? '' : 'off'}">
        <input type="checkbox" data-id="${esc(v.id)}" ${on ? 'checked' : ''} ${f.ready ? '' : 'disabled'}>
        <span class="sa-name">${esc(v.name)}</span>
        <span class="sa-homes">${plural(v.homes, 'home')}${v.lastSent ? ` · sent ${esc(agoLabel(v.lastSent))}` : ' · never sent'}</span>
        <span class="sa-mail ${f.hasEmail ? '' : 'missing'}">${
          f.hasEmail ? esc(v.recipients.join('; '))
          : !f.sendable ? 'nothing to report this period'
          : 'no Status Update Email on the Vendors board'}</span>
        <span class="sa-result" data-result="${esc(v.id)}"></span>
      </label>`).join('');
  }

  $('sendAllBtn').onclick = () => {
    $('sendAllSub').textContent = `${period().range}. Everyone below gets their own report, sent to the address on the Vendors board. Untick anyone who should sit this one out.`;
    renderSendAll(sendAllRows());
    msg('sendAllMsg', '');
    setBusy(false);
    $('sendAllOverlay').classList.add('open');
  };
  $('sendAllClose').onclick = () => $('sendAllOverlay').classList.remove('open');

  let sending = false;

  function setBusy(on, text) {
    const busy = $('sendAllBusy');
    busy.classList.toggle('on', on);
    busy.classList.remove('done');
    if (text) $('sendAllBusyText').innerHTML = text;
    $('sendAllGo').disabled = on;
    $('sendAllClose').disabled = on;
    if (on) $('sendAllList').querySelectorAll('input').forEach((el) => { el.disabled = true; });
  }

  $('sendAllGo').onclick = async () => {
    if (sending) return;
    const ids = [...$('sendAllList').querySelectorAll('input:checked')].map((el) => el.dataset.id);
    if (!ids.length) { msg('sendAllMsg', 'Nobody is selected.', 'err'); return; }
    sending = true;
    msg('sendAllMsg', '');
    setBusy(true, `Sending ${ids.length} report${ids.length === 1 ? '' : 's'}&hellip;`);
    try {
      const out = await api('/api/send-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodKey: range, vendorIds: ids }),
      });
      for (const r of out.results) {
        const el = $('sendAllList').querySelector(`[data-result="${r.vendorId}"]`);
        if (!el) continue;
        el.className = `sa-result ${r.status}`;
        el.textContent = r.status === 'sent' ? `sent to ${r.to.join('; ')}` : `${r.status}: ${r.error}`;
      }
      const t = out.tally;
      const busy = $('sendAllBusy');
      busy.classList.add('done');
      $('sendAllBusyText').textContent = t.failed
        ? `${t.sent || 0} sent, ${t.failed} failed`
        : `Completed — ${t.sent || 0} sent`;
      busy.querySelector('.busy-note').textContent = t.failed
        ? 'Some sends failed — details below.'
        : `All reports delivered from ${out.from}.`;
      if (t.failed) {
        setTimeout(() => { busy.classList.remove('on'); $('sendAllClose').disabled = false; }, 1600);
        msg('sendAllMsg', `${t.sent || 0} sent, ${t.skipped || 0} skipped, ${t.failed} FAILED — see each row above.`, 'err');
      } else {
        setTimeout(() => {
          $('sendAllOverlay').classList.remove('open');
          setBusy(false);
          load();
        }, 2000);
      }
    } catch (err) {
      setBusy(false);
      msg('sendAllMsg', err.message, 'err');
    }
    sending = false;
  };

  // ---- navigation + filters ----------------------------------------------
  $('backToVendors').onclick = () => { current = null; document.body.dataset.screen = 'vendors'; renderVendors(); window.scrollTo(0, 0); };
  $('backBtn').onclick = () => { document.body.dataset.screen = 'detail'; window.scrollTo(0, 0); };
  $('createBtn').onclick = () => { buildPaper(); document.body.dataset.screen = 'report'; window.scrollTo(0, 0); };
  $('refreshBtn').onclick = () => load(true);
  $('printBtn').onclick = () => window.print();

  $('range').onchange = (e) => {
    range = e.target.value;
    renderVendors();
    if (current) renderDetail();
  };
  $('sort').onchange = (e) => { sort = e.target.value; renderVendors(); };

  let qTimer = null;
  $('q').oninput = (e) => {
    clearTimeout(qTimer);
    const val = e.target.value.trim().toLowerCase();
    qTimer = setTimeout(() => { query = val; renderVendors(); }, 120);
  };

  $('copyBtn').onclick = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([$('paper').innerHTML], { type: 'text/html' }),
        'text/plain': new Blob([$('paper').innerText], { type: 'text/plain' }),
      })]);
      $('copyBtn').textContent = 'Copied';
    } catch {
      const r = document.createRange(); r.selectNode($('paper'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      $('copyBtn').textContent = 'Selected — press Ctrl/Cmd+C';
    }
    setTimeout(() => { $('copyBtn').textContent = 'Copy for email'; }, 2600);
  };

  load();
})();
