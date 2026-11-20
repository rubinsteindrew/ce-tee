/* CE & Tee — account page: sign in, create account, confirm email, reset password, member area. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dates = (a, b) => {
    if (!a || !b) return '';
    const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
    return y1 === y2 && m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}, ${y1}` : `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
  };
  const q = new URLSearchParams(location.search);
  // only follow same-site paths after signing in
  const next = (q.get('next') || '').startsWith('/') && !q.get('next').startsWith('//') ? q.get('next') : '';

  async function call(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }
  const busy = (form, on, label) => {
    const b = form.querySelector('[type=submit]');
    b.disabled = on;
    if (on) { b.dataset.label = b.firstElementChild.textContent; b.firstElementChild.textContent = label || 'One moment…'; }
    else if (b.dataset.label) b.firstElementChild.textContent = b.dataset.label;
  };
  const showErr = (form, msg) => { form.querySelector('.form-err').textContent = msg || ''; };
  const notice = (el, html, good) => { el.innerHTML = html ? `<div class="notice${good ? ' good' : ''}">${html}</div>` : ''; };
  const clean = () => history.replaceState(null, '', location.pathname + (next ? `?next=${encodeURIComponent(next)}` : ''));

  /* ---------- views ---------- */
  const authView = $('#authView'), memberView = $('#memberView');
  const panes = { tabs: $('#paneTabs'), forgot: $('#formForgot'), reset: $('#formReset') };
  const showPane = (name) => { for (const [k, el] of Object.entries(panes)) el.hidden = k !== name; };
  function setTab(up) {
    $('#tabIn').setAttribute('aria-selected', String(!up));
    $('#tabUp').setAttribute('aria-selected', String(up));
    $('#formIn').hidden = up; $('#formUp').hidden = !up;
    $('#authTitle').textContent = up ? 'Join CE & Tee' : 'Welcome back';
    $('#authSub').textContent = up ? 'Create a free account to reserve trips and keep your course records together.' : 'Sign in to see and manage your trips.';
  }
  $('#tabIn').addEventListener('click', () => setTab(false));
  $('#tabUp').addEventListener('click', () => setTab(true));
  $('#toForgot').addEventListener('click', () => { showPane('forgot'); $('#formForgot').email.value = $('#formIn').email.value; });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { showPane('tabs'); setTab(false); }));

  const GOOGLE_ERRORS = {
    'google-off': 'Google sign-in isn’t switched on yet. Use your email for now.',
    'google-cancelled': 'Google sign-in was cancelled.',
    'google-state': 'That Google sign-in expired. Please try again.',
    'google-unverified': 'Google hasn’t confirmed that email address, so we can’t use it to sign in.',
    'google-failed': 'Google sign-in didn’t work. Please try again, or use your email.',
  };

  function signedIn(user, msg) {
    if (next) { location.href = next; return; }
    authView.hidden = true; memberView.hidden = false;
    $('#hello').textContent = user.name.split(' ')[0];
    $('#adminLink').hidden = !user.admin;
    const p = $('#formProfile');
    p.name.value = user.name; p.email.value = user.email; p.practice.value = user.practice; p.phone.value = user.phone;
    $('#emailState').textContent = user.google ? '· via Google' : user.verified ? '· confirmed' : '· not confirmed yet';
    $('#pwCurrent').hidden = !user.hasPassword; $('#pwNote').hidden = user.hasPassword;
    $('#formPassword').current.required = user.hasPassword;
    $('#formPassword').querySelector('[type=submit] span').textContent = user.hasPassword ? 'Change password' : 'Set a password';
    const acct = $('#navAcct'); acct.textContent = user.name.split(' ')[0]; acct.classList.add('in');
    if (msg) notice($('#memberNotice'), esc(msg), true);
    else if (!user.verified) {
      notice($('#memberNotice'), `<span>Please confirm your email. We sent a link to <b>${esc(user.email)}</b>.</span><button class="linkbtn" id="resend" type="button">Send it again</button>`);
      $('#resend').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try { await call('POST', '/api/auth/resend'); e.target.textContent = 'Sent. Check your inbox.'; }
        catch (ex) { e.target.textContent = ex.message; }
      });
    } else notice($('#memberNotice'), '');
    loadTrips();
  }
  function signedOut() { memberView.hidden = true; authView.hidden = false; showPane('tabs'); setTab(q.get('mode') === 'signup'); }

  async function loadTrips() {
    const list = $('#resList');
    try {
      const { reservations } = await call('GET', '/api/account/reservations');
      if (!reservations.length) {
        list.innerHTML = '<div class="empty-card">No trips yet. When you reserve a spot it will show up here.<br><a class="btn btn-flag" href="/trips"><span>Browse trips</span></a></div>';
        return;
      }
      list.innerHTML = reservations.map((r) => `
        <div class="res">
          ${r.trip.image ? `<img src="${esc(r.trip.image)}" alt="">` : '<span></span>'}
          <div>
            <b>${esc(r.trip.club || r.trip.name)}</b>
            <small>${esc(r.trip.name)} · ${esc(dates(r.trip.startDate, r.trip.endDate))}</small>
            <small>${esc(r.trip.courseTitle || '')}${r.trip.credits ? ` · ${esc(r.trip.credits)} CE hours` : ''}</small>
            <small>${esc(r.spots)} spot${r.spots > 1 ? 's' : ''} · ${money(r.deposit)} deposit</small>
          </div>
          <span class="tag ${r.demo ? 'demo' : 'paid'}">${r.demo ? 'Preview, unpaid' : 'Deposit paid'}</span>
        </div>`).join('');
    } catch (ex) { list.innerHTML = `<p class="form-err">${esc(ex.message)}</p>`; }
  }

  /* ---------- forms ---------- */
  $('#formIn').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; showErr(f);
    if (!f.email.value || !f.password.value) return showErr(f, 'Enter your email and password.');
    busy(f, true);
    try { const { user } = await call('POST', '/api/auth/login', { email: f.email.value, password: f.password.value }); f.reset(); signedIn(user); }
    catch (ex) { showErr(f, ex.message); }
    busy(f, false);
  });
  $('#formUp').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; showErr(f);
    if (!f.name.value.trim() || !f.email.value) return showErr(f, 'Enter your name and email.');
    if (f.password.value.length < 10) return showErr(f, 'Use a password of at least 10 characters.');
    busy(f, true, 'Creating your account…');
    try {
      const { user } = await call('POST', '/api/auth/signup', { name: f.name.value, email: f.email.value, practice: f.practice.value, password: f.password.value });
      f.reset(); signedIn(user);
    } catch (ex) { showErr(f, ex.message); }
    busy(f, false);
  });
  $('#formForgot').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; showErr(f);
    busy(f, true);
    try { await call('POST', '/api/auth/forgot', { email: f.email.value }); showPane('tabs'); setTab(false); notice($('#notice'), 'If that email has an account, a reset link is on its way. It works for one hour.', true); }
    catch (ex) { showErr(f, ex.message); }
    busy(f, false);
  });
  $('#formReset').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; showErr(f);
    busy(f, true);
    try { const { user } = await call('POST', '/api/auth/reset', { token: q.get('reset'), password: f.password.value }); clean(); signedIn(user, 'Your password has been changed.'); }
    catch (ex) { showErr(f, ex.message); }
    busy(f, false);
  });
  $('#formProfile').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; showErr(f);
    busy(f, true, 'Saving…');
    try { const { user } = await call('PUT', '/api/account/profile', { name: f.name.value, practice: f.practice.value, phone: f.phone.value }); $('#hello').textContent = user.name.split(' ')[0]; showErr(f, ''); f.querySelector('.form-err').textContent = ''; busy(f, false); f.querySelector('[type=submit] span').textContent = 'Saved'; setTimeout(() => { f.querySelector('[type=submit] span').textContent = 'Save profile'; }, 1800); return; }
    catch (ex) { showErr(f, ex.message); }
    busy(f, false);
  });
  $('#formPassword').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; showErr(f);
    busy(f, true, 'Saving…');
    try { await call('POST', '/api/account/password', { current: f.current.value, password: f.password.value }); f.reset(); notice($('#memberNotice'), 'Your password has been changed. Other devices have been signed out.', true); }
    catch (ex) { showErr(f, ex.message); }
    busy(f, false);
  });
  $('#signOut').addEventListener('click', async () => { await call('POST', '/api/auth/logout').catch(() => {}); location.href = '/'; });

  /* ---------- start ---------- */
  (async () => {
    if (q.get('reset')) { authView.hidden = false; showPane('reset'); return; }
    if (q.get('verify')) {
      try { const { user } = await call('POST', '/api/auth/verify', { token: q.get('verify') }); clean(); signedIn(user, 'Your email is confirmed. Thanks!'); return; }
      catch (ex) { clean(); notice($('#notice'), esc(ex.message) + ' Sign in to send a new one.'); }
    }
    const { user, google } = await call('GET', '/api/auth/me').catch(() => ({ user: null }));
    if (google) { $('#googleBox').hidden = false; if (next) $('#googleBtn').href = '/api/auth/google?next=' + encodeURIComponent(next); }
    if (q.get('error')) { notice($('#notice'), esc(GOOGLE_ERRORS[q.get('error')] || 'Sign-in didn’t work. Please try again.')); clean(); }
    if (user) { if (next) location.href = next; else signedIn(user); }
    else {
      signedOut();
      if (next === '/admin') notice($('#notice'), 'Sign in with your CE &amp; Tee staff account to open the admin pages.');
      else if (next) notice($('#notice'), 'Sign in or create a free account to reserve your spot.');
    }
  })();
})();
