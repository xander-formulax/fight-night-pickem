// Vendor Reporting Centre — frontend.
//
// Read-only. Nothing here can send anything; the backend has no send path.
// The user exports a PDF or copies the report into their own mail client.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STATE_LABEL = { complete: 'Complete', active: 'On track', stalled: 'Stalled', unscoped: 'Not scoped' };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  let DATA = null;
  let current = null;
  let range = 'this-week';

  // ---- talking to our backend --------------------------------------------
  // monday hands the iframe a short-lived session token; the backend verifies
  // it before returning anything.
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

  // ---- rendering ----------------------------------------------------------
  function renderRail() {
    $('vendorList').innerHTML = DATA.vendors.map((v) => {
      const attention = (v.counts.stalled || 0) + (v.counts.unscoped || 0);
      return `<button class="vbtn" data-id="${esc(v.id)}" aria-current="${v.id === current.id}">
        ${esc(v.name)}${attention ? '<span class="dot" title="needs attention"></span>' : ''}
        <small>${plural(v.homes, 'home')}</small></button>`;
    }).join('');
    $('vendorList').querySelectorAll('.vbtn').forEach((b) => {
      b.onclick = () => { current = DATA.vendors.find((v) => v.id === b.dataset.id); renderAll(); };
    });
  }

  function renderKpis() {
    const c = current.counts;
    const cells = [
      { n: current.homes, l: 'homes', cls: '' },
      { n: current.reports[range].completedCount, l: 'finished this period', cls: 'ok' },
      { n: c.stalled || 0, l: 'stalled', cls: c.stalled ? 'crit' : '' },
      { n: c.unscoped || 0, l: 'not scoped yet', cls: c.unscoped ? 'warn' : '' },
    ];
    $('kpis').innerHTML = cells.map((k) =>
      `<div class="kpi ${k.cls}"><b>${k.n}</b><span>${k.l}</span></div>`).join('');
  }

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

  function homeRow(j) {
    const body = j.state === 'unscoped'
      ? `<div class="empty">No build phases are marked Yes on this job yet, so there is nothing to report. Set the phase columns in monday and it will fill in.</div>`
      : lists(j);
    const meta = [
      j.lastActivityLabel ? `Last finished ${esc(j.lastActivityLabel)}` : 'Nothing finished yet',
      j.nextScheduledLabel ? `Next up ${esc(j.nextScheduledLabel)}` : 'Nothing scheduled',
    ];
    return `<article class="home ${esc(j.state)}">
      <button class="home-top" type="button">
        <span><span class="home-name">${esc(j.name)}</span><br><span class="home-addr">${esc(j.address)}</span></span>
        <span class="home-right">
          ${j.state === 'unscoped' ? '' :
            `<span class="meter"><i style="width:${Number(j.progress.pct) || 0}%"></i></span>
             <span class="frac mono">${j.progress.done} of ${j.progress.total}</span>`}
          <span class="pill ${esc(j.state)}">${STATE_LABEL[j.state]}</span>
        </span>
        <span class="home-meta">${meta.map((m) => `<span>${m}</span>`).join('')}</span>
      </button>
      <div class="home-body">${body}</div>
    </article>`;
  }

  function renderHomes() {
    const order = { stalled: 0, unscoped: 1, active: 2, complete: 3 };
    const jobs = current.reports[range].jobs.slice()
      .sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
    $('homes').innerHTML = jobs.map(homeRow).join('');
    $('homes').querySelectorAll('.home-top').forEach((b) => {
      b.onclick = () => b.parentElement.classList.toggle('open');
    });
  }

  function renderAll() {
    $('vName').textContent = current.name;
    $('vSub').textContent = `${plural(current.homes, 'home')} · `
      + (current.lastActivityLabel ? `last work finished ${current.lastActivityLabel}` : 'no work finished yet')
      + ' · ' + (current.nextScheduledLabel ? `next booked ${current.nextScheduledLabel}` : 'nothing booked');
    renderRail(); renderKpis(); renderHomes();
    $('rLabel').textContent = `${current.name} — ${DATA.ranges.find((r) => r.key === range).range}`;
  }

  // ---- the exportable report ---------------------------------------------
  function buildPaper() {
    const rep = current.reports[range];
    const periodLabel = DATA.ranges.find((r) => r.key === range).range;
    // A home with no phases marked has nothing truthful to say to a customer.
    const shown = rep.jobs.filter((j) => j.state !== 'unscoped');
    const rows = shown.map((j) => `<div class="p-job"><h3>${esc(j.name)}</h3>
        <p class="p-addr">${esc(j.address)}</p>
        <div class="p-prog"><span class="meter"><i style="width:${Number(j.progress.pct) || 0}%"></i></span>
          <span class="frac mono">${j.progress.done} of ${j.progress.total} steps</span></div>
        ${lists(j, 'No tasks were completed on this home this period.')}</div>`).join('');

    const c = shown.reduce((a, j) => a + j.completed.length, 0);
    $('paper').innerHTML = `<p class="p-brand">Dragon Transport</p>
      <h2 class="p-title">Progress Report</h2>
      <p class="p-dates">${esc(current.name)} · ${esc(periodLabel)}</p>
      <p class="p-count"><strong>${plural(shown.length, 'home')}</strong> · ${plural(c, 'task')} completed this period</p>
      ${rows}
      <p class="p-foot">Questions on any home above? Reply to this email or call the office.</p>`;
  }

  // ---- wiring -------------------------------------------------------------
  function boot(data) {
    DATA = data;
    if (!DATA.vendors.length) {
      $('errMsg').textContent = 'No vendors have jobs linked to them yet. Fill in "Bill to" on the Jobs board and refresh.';
      document.body.className = 'errored';
      return;
    }
    current = DATA.vendors.find((v) => v.id === current?.id) || DATA.vendors[0];
    $('range').innerHTML = DATA.ranges.map((r) =>
      `<option value="${esc(r.key)}"${r.key === range ? ' selected' : ''}>${esc(r.label)} — ${esc(r.range)}</option>`).join('');
    $('stamp').textContent = `Board data as of ${new Date().toLocaleTimeString()}`;
    document.body.className = '';
    renderAll();
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
        ? `Currently sending as <b>${st.address.replace(/[<>&]/g, '')}</b>`
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
      $('settingsStatus').innerHTML = `Currently sending as <b>${st.address.replace(/[<>&]/g, '')}</b>`;
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

  // ---- email: send the open report ---------------------------------------
  const lastRecipients = {}; // per-vendor, per session

  $('sendBtn').onclick = () => {
    if (!current) return;
    const period = DATA.ranges.find((r) => r.key === range);
    $('sendTitle').textContent = `Send — ${current.name}`;
    $('sendSub').textContent = `${period.range}. The email is rebuilt from the boards on send; unscoped homes are left out.`;
    $('sendTo').value = lastRecipients[current.id] || '';
    msg('sendMsg', '');
    $('sendOverlay').classList.add('open');
    $('sendTo').focus();
  };
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
      setTimeout(() => $('sendOverlay').classList.remove('open'), 1800);
    } catch (err) { msg('sendMsg', err.message, 'err'); }
    btn.disabled = false;
  };

  $('range').onchange = (e) => { range = e.target.value; renderAll(); };
  $('refreshBtn').onclick = () => load(true);
  $('createBtn').onclick = () => { buildPaper(); document.body.classList.add('showing-report'); window.scrollTo(0, 0); };
  $('backBtn').onclick = () => document.body.classList.remove('showing-report');
  $('printBtn').onclick = () => window.print();
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
