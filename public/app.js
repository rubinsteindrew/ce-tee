/* CE & Tees — shared behaviour for every public page.
   Each block only runs if its section is on the page.
   Scroll-linked motion is a pure function of scroll position, so it rewinds
   exactly when you scroll back. The footer "Motion" switch turns it down. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };
  const calm = document.documentElement.classList.contains('calm');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
  const isHome = document.body.dataset.page === 'home';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dates = (a, b) => {
    const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
    return y1 === y2 && m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}, ${y1}` : `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
  };

  /* ---------- footer ---------- */
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  const toggle = $('#motionToggle');
  if (toggle) {
    toggle.textContent = calm ? 'Motion: reduced' : 'Motion: on';
    toggle.setAttribute('aria-pressed', String(calm));
    toggle.addEventListener('click', () => {
      try { localStorage.setItem('ce-motion', calm ? 'full' : 'calm'); } catch (e) {}
      location.reload();
    });
  }

  /* ---------- nav, phone menu, signed-in state ---------- */
  const nav = $('#nav'), menuBtn = $('#navMenu');
  const setMenu = (open) => {
    nav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.querySelector('b').textContent = open ? 'Close menu' : 'Menu';
    document.body.classList.toggle('menu-open', open);
  };
  if (menuBtn) {
    menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
    $$('.nav-links a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });
  }
  let me = null, isStatic = false;
  // On a static host (GitHub Pages) there is no /api: accounts and booking are switched off.
  const meReady = fetch('/api/auth/me').then((r) => { if (!r.ok) throw new Error('no api'); return r.json(); })
    .then((d) => { me = d.user; return me; })
    .catch(() => {
      isStatic = true;
      document.documentElement.classList.add('static-host');
      return null;
    });
  meReady.then((u) => {
    const links = $('#navLinks');
    if (links && !isStatic) {   // the phone menu also needs a way into the account page
      const a = document.createElement('a');
      a.href = '/account'; a.className = 'menu-only'; a.textContent = u ? 'My account' : 'Sign in';
      links.append(a);
    }
    const acct = $('#navAcct');
    if (!acct || !u) return;
    acct.textContent = u.name.split(' ')[0];
    acct.classList.add('in');
    if (u.admin) {
      const a = document.createElement('a');
      a.href = '/admin'; a.textContent = 'Admin';
      $('#navLinks').append(a);
    }
  });

  /* ---------- statement: words light up as you read ---------- */
  const statement = $('#statement');
  let beats = [], beatsOn = -1;
  if (statement) {
    (function split(node) {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part.trim()) { if (part) frag.append(' '); return; }
            const s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.append(s);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && !child.classList.contains('pill')) split(child);
      }
    })(statement);
    beats = $$('.w, .pill', statement);
  }

  /* ---------- the day (sun crosses the page, day turns to night) ---------- */
  const day = $('#day');
  let poseDay = null, nightNow = false;
  if (day) {
    const stick = $('#dayStick'), sun = $('.orb-sun'), moon = $('.orb-moon');
    const clockTime = $('#clockTime'), clockAmpm = $('#clockAmpm');
    const stops = $$('.stop'), rail = $$('#rail li'), photos = $$('#dayPhotos figure');
    const TIMES = [390, 450, 735, 810, 1110, 1140, 1320];   // minutes after midnight for each stop, then lights out
    const SUNRISE = 345, SUNSET = 1185, MOONRISE = 1110;
    const SKY = [[390, [242, 237, 225]], [900, [246, 233, 205]], [1075, [241, 196, 136]], [1130, [208, 124, 80]], [1172, [86, 50, 66]], [1215, [14, 22, 38]], [1320, [14, 22, 38]]];
    const skyAt = (t) => {
      let i = 0; while (i < SKY.length - 2 && t > SKY[i + 1][0]) i++;
      const [t0, a] = SKY[i], [t1, b] = SKY[i + 1], k = clamp((t - t0) / (t1 - t0));
      return `rgb(${a.map((v, j) => Math.round(lerp(v, b[j], k))).join(',')})`;
    };
    const last = {};
    const set = (key, el, val) => { if (last[key] !== val) { last[key] = val; el.textContent = val; } };
    poseDay = (p) => {
      const f = p * 6, seg = Math.min(5, Math.floor(f)), t = lerp(TIMES[seg], TIMES[seg + 1], f - seg);
      const st = stick.style, dark = t > 1150;
      st.setProperty('--p', p.toFixed(4));
      st.setProperty('--night', smooth(1090, 1200, t).toFixed(3));
      st.setProperty('--bg', skyAt(t));
      if (last.dark !== dark) {
        last.dark = dark; nightNow = dark;
        st.setProperty('--fg', dark ? '#f2ede1' : '#14261d');
        st.setProperty('--sub', dark ? '#c3cad9' : '#4c5a4c');
        st.setProperty('--hot', dark ? '#f2bd45' : '#a8321c');
      }
      const arc = (fr) => [geo.cx - geo.rx * Math.cos(Math.PI * fr), geo.baseY - geo.ry * Math.sin(Math.PI * fr)];
      const [sx, sy] = arc((t - SUNRISE) / (SUNSET - SUNRISE)), [mx, my] = arc((t - MOONRISE) / 720);
      sun.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
      moon.style.transform = `translate3d(${mx.toFixed(1)}px,${my.toFixed(1)}px,0)`;
      const m = Math.round(t / 5) * 5, h24 = Math.floor(m / 60);
      set('time', clockTime, `${((h24 + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')}`);
      set('ampm', clockAmpm, h24 < 12 ? 'AM' : 'PM');
      const shown = Math.min(5, Math.floor(f + 0.17));
      if (last.seg !== shown) {
        last.seg = shown;
        stops.forEach((s, i) => { s.classList.toggle('on', i === shown); s.classList.toggle('gone', i < shown); });
        rail.forEach((li, i) => li.classList.toggle('on', i === shown));
      }
      photos.forEach((fig, i) => {
        const r = i === 0 ? 1 : smooth(i - 0.34, i, f);
        const key = 'ph' + i, val = r.toFixed(3) + (f - i).toFixed(2);
        if (last[key] === val) return; last[key] = val;
        fig.style.clipPath = r >= 1 ? 'none' : `inset(${((1 - r) * 100).toFixed(2)}% 0 0 0 round 22px)`;
        fig.style.visibility = r <= 0 ? 'hidden' : 'visible';
        if (!calm) fig.firstElementChild.style.transform = `scale(${(1.04 + 0.2 * (1 - r) + 0.07 * clamp(f - i, 0, 1.4)).toFixed(4)})`;
      });
    };
    $$('#rail button').forEach((b) => b.addEventListener('click', () => {
      scrollTo({ top: geo.dayTop + ((+b.dataset.stop + 0.45) / 6) * geo.dayLen, behavior: calm ? 'instant' : 'smooth' });
    }));
  }

  /* ---------- geometry ---------- */
  const hero = $('#hero'), intro = $('#intro');
  const tracer = $('.tracer'), tracerLine = $('#tracerLine'), tracerGlow = $('#tracerGlow'), tracerGhost = $('#tracerGhost'),
    tracerRoll = $('#tracerRoll'), tracerBall = $('#tracerBall'), tracerShadow = $('#tracerShadow');
  const attrs = (el, a) => { for (const k in a) el.setAttribute(k, typeof a[k] === 'number' ? a[k].toFixed(1) : a[k]); };
  const marquees = $$('.marquee-row').map((row) => ({ el: row.firstElementChild, dir: +row.dataset.dir, half: 1 }));
  const strips = $$('.strip-row').map((el) => ({ el, dir: +el.dataset.dir }));
  const stripSec = $('.strip'), closer = $('.closer'), closerBg = $('.closer-bg');
  const darkZones = ['.ce', '.strip', '.closer', '.foot', '.next-band.dark'].map((s) => $(s)).filter(Boolean);
  let stampEls = $$('.stamp-spin'), cards = [], geo = null, dirty = true, lastY = -1;

  function measure() {
    geo = { vh: innerHeight, vw: innerWidth };
    marquees.forEach((m) => { m.half = m.el.scrollWidth / 2; });
    if (tracer) {
      // A real shot shape: climbs steeply, peaks past halfway, then falls more steeply than it rose.
      // It lands on the green short of the pin, hops once and rolls into the cup.
      // Tee on the left and green on the right share one ground line, set just above the "What CE & Tees is" heading.
      const W = intro.clientWidth, H = tracer.clientHeight, R = 6.5, TEE = 5;
      const tr = tracer.getBoundingClientRect(), kicker = $('.kicker', intro);
      const ground = Math.min(0.82 * H + R, kicker.getBoundingClientRect().top - tr.top - 24);
      const pad = parseFloat(getComputedStyle(intro).paddingLeft) || 0.03 * W;
      const x0 = pad + 10, y0 = ground - TEE - R;     // the ball sitting on its tee
      const xh = Math.min(0.955 * W, W - 36), xl = xh - Math.max(34, 0.075 * W), D = xl - x0;
      const yb = ground - R;                          // ball centre when it sits on the green
      const k = Math.max(20, yb - 6) / 0.737;         // apex lands just inside the top of the drawing area
      const flight = `M ${x0.toFixed(1)} ${y0.toFixed(1)} C ${(x0 + 0.27 * D).toFixed(1)} ${(yb - 1.07 * k).toFixed(1)} ${(x0 + 0.83 * D).toFixed(1)} ${(yb - 0.93 * k).toFixed(1)} ${xl.toFixed(1)} ${yb.toFixed(1)}`;
      attrs($('#tracerTeeBox'), { cx: x0 + 4, cy: ground + 1, rx: 26, ry: 5.5 });
      attrs($('#tracerTee'), { d: `M ${(x0 - 4).toFixed(1)} ${(ground - TEE).toFixed(1)} h 8 l -2.6 2.4 v ${TEE + 2} l -1.4 2 l -1.4 -2 v ${-(TEE + 2)} z` });
      const hop = xl + (xh - xl) * 0.42;
      const roll = `M ${xl.toFixed(1)} ${yb.toFixed(1)} Q ${((xl + hop) / 2).toFixed(1)} ${(yb - Math.min(16, 0.09 * H)).toFixed(1)} ${hop.toFixed(1)} ${yb.toFixed(1)} L ${xh.toFixed(1)} ${yb.toFixed(1)}`;
      tracer.setAttribute('viewBox', `0 0 ${W} ${H}`);
      for (const p of [tracerLine, tracerGlow, tracerGhost]) p.setAttribute('d', flight);
      tracerRoll.setAttribute('d', roll);
      const gcx = (xl + xh) / 2 + 4, grx = Math.min(W - gcx - 4, (xh - xl) / 2 + 30);
      attrs($('#tracerFringe'), { cx: gcx, cy: ground + 1, rx: grx + 6, ry: 11 });
      attrs($('#tracerGreen'), { cx: gcx, cy: ground, rx: grx, ry: 8.5 });
      attrs($('#tracerCup'), { cx: xh, cy: ground, rx: 6.2, ry: 2.3 });
      const pole = Math.max(52, Math.min(80, 0.36 * H));
      attrs($('#tracerStick'), { x: xh - 1.3, y: ground - pole, height: pole });
      attrs($('#tracerFlag'), { d: `M ${(xh + 1.3).toFixed(1)} ${(ground - pole).toFixed(1)} c 7 2 13 -1 22 4 c -8 4 -14 2 -22 9 z` });
      geo.len = tracerLine.getTotalLength(); geo.roll = tracerRoll.getTotalLength();
      Object.assign(geo, { yb, ground, H, gx0: gcx - grx + 4, gx1: gcx + grx - 4 });
      tracerLine.style.strokeDasharray = tracerGlow.style.strokeDasharray = `${geo.len} ${geo.len}`;
    }
    if (day) {
      const stick = $('#dayStick'), sky = $('.sky');
      const sr = stick.getBoundingClientRect(), kr = sky.getBoundingClientRect();
      Object.assign(geo, {
        dayTop: day.getBoundingClientRect().top + scrollY, dayLen: Math.max(1, day.offsetHeight - innerHeight),
        cx: stick.clientWidth / 2, rx: stick.clientWidth * 0.47, baseY: kr.bottom - sr.top, ry: kr.height * (285 / 300),
      });
    }
    // a card taller than the window sticks higher up, so its reserve button is never covered
    cards.forEach((c, i) => { c.top = Math.min(76 + i * 14, innerHeight - c.el.offsetHeight - 16); c.el.style.top = innerWidth > 800 ? c.top + 'px' : ''; });
  }

  /* ---------- one loop for everything that follows the scroll ---------- */
  let t0 = performance.now();
  function frame(now) {
    const y = window.pageYOffset;
    if (!geo) measure();
    const { vh, vw } = geo, secs = calm ? 0 : (now - t0) / 1000;

    for (const m of marquees) {
      const x = ((y * 0.45 + secs * 46) % m.half + m.half) % m.half;
      m.el.style.transform = `translate3d(${(m.dir < 0 ? -x : x - m.half).toFixed(1)}px,0,0)`;
    }
    if (stampEls.length) { const rot = (y * 0.11 + secs * 7).toFixed(2) + 'deg'; for (const s of stampEls) s.style.setProperty('--rot', rot); }

    if (y !== lastY || dirty) {
      lastY = y; dirty = false;
      if (hero && y < vh * 1.2) hero.style.setProperty('--hp', calm ? '0' : clamp(y / (vh * 0.9)).toFixed(4));

      if (tracer) {
        const ir = intro.getBoundingClientRect();
        if (ir.bottom > -100 && ir.top < vh + 100) {
          const tp = clamp((vh * 0.92 - ir.top) / (vh * 0.95));
          // 0 to 0.78 of the scroll is the flight, then the hop and roll; the last sliver drops it in the cup
          const fly = clamp(tp / 0.78), rolled = clamp((tp - 0.78) / 0.2);
          tracerLine.style.strokeDashoffset = tracerGlow.style.strokeDashoffset = (geo.len * (1 - fly)).toFixed(1);
          const pt = fly < 1 ? tracerLine.getPointAtLength(geo.len * fly) : tracerRoll.getPointAtLength(geo.roll * rolled);
          const sunk = clamp((tp - 0.975) / 0.025);
          const bx = pt.x, by = pt.y + sunk * 7;
          tracerBall.setAttribute('transform', `translate(${bx.toFixed(1)} ${by.toFixed(1)}) scale(${(1 - sunk * 0.45).toFixed(3)})`);
          tracerBall.style.opacity = (1 - sunk).toFixed(2);
          // the shadow stays on the ground under the ball: smaller and fainter the higher it flies
          const lift = clamp((geo.yb - pt.y) / (geo.H * 1.2));
          attrs(tracerShadow, { cx: bx + 1.5, cy: geo.ground + 1, rx: 6.5 * (1 - lift * 0.5), ry: 2 * (1 - lift * 0.5) });
          const overGreen = bx > geo.gx0 && bx < geo.gx1;
          tracerShadow.style.opacity = overGreen ? (0.34 * (1 - lift * 0.8) * (1 - sunk)).toFixed(2) : '0';
        }
      }
      if (statement) {
        const r = statement.getBoundingClientRect();
        const k = Math.round(clamp((vh * 0.86 - r.top) / (r.height + vh * 0.3)) * beats.length);
        if (k !== beatsOn) { beatsOn = k; beats.forEach((b, i) => b.classList.toggle(b.classList.contains('pill') ? 'in' : 'on', i < k)); }
      }

      let overDay = false;
      if (day) {
        if (y > geo.dayTop - vh && y < geo.dayTop + geo.dayLen + vh) poseDay(clamp((y - geo.dayTop) / geo.dayLen));
        const db = day.getBoundingClientRect();
        overDay = db.top < 66 && db.bottom > 30;   // the nav sits on the day section: follow its sky
      }
      nav.classList.toggle('solid', !isHome || y > 30);
      nav.classList.toggle('pine', isHome && y < vh * 0.97);
      nav.classList.toggle('dark', overDay ? nightNow : darkZones.some((z) => { const b = z.getBoundingClientRect(); return b.top < 66 && b.bottom > 30; }));

      if (stripSec) {
        const sb = stripSec.getBoundingClientRect();
        if (sb.bottom > 0 && sb.top < vh) {
          const sp = clamp((vh - sb.top) / (vh + sb.height));
          for (const s of strips) s.el.style.transform = `translate3d(${(s.dir * sp * vw * 0.4).toFixed(1)}px,0,0)`;
        }
      }
      if (!calm && vw > 800) {
        cards.forEach((c, i) => {
          const b = c.el.getBoundingClientRect();
          if (b.bottom < -200 || b.top > vh + 200) return;
          const next = cards[i + 1];
          const s = next ? clamp(1 - (next.el.getBoundingClientRect().top - c.top) / (b.height * 0.9)) : 0;
          c.inner.style.setProperty('--s', s.toFixed(3));
          c.img.style.transform = `translate3d(0,${clamp((b.top + b.height / 2 - vh / 2) * -0.05, -40, 40).toFixed(1)}px,0)`;
        });
      }
      if (closer && !calm) {
        const cb = closer.getBoundingClientRect();
        if (cb.bottom > 0 && cb.top < vh) closerBg.style.transform = `translate3d(0,${(cb.top * -0.12).toFixed(1)}px,0)`;
      }
    }
    if (!document.hidden) requestAnimationFrame(frame);
  }
  const kick = () => { geo = null; dirty = true; };
  addEventListener('resize', kick);
  if (window.ResizeObserver) new ResizeObserver(kick).observe(document.body);   // content swaps (sign-in, trip lists) move things too
  addEventListener('load', kick);
  if (document.fonts) document.fonts.ready.then(kick);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { t0 = performance.now(); requestAnimationFrame(frame); } });
  measure();
  if (poseDay) poseDay(0);
  requestAnimationFrame(frame);

  /* ---------- reveals and counters ---------- */
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
      const n = e.target.matches('[data-count]') ? e.target : $('[data-count]', e.target);
      if (n) countUp(n);
      const bar = $('.meter i', e.target);
      if (bar) bar.style.width = bar.dataset.w + '%';
    }
  }, { threshold: 0.15 });
  const watch = (root = document) => $$('.rv, .clipin, .closer', root).forEach((el) => io.observe(el));
  watch();
  function countUp(el) {
    const to = +el.dataset.count;
    if (calm || !to) return;
    const start = performance.now();
    (function step(now) {
      const k = clamp((now - start) / 1100);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4)));
      if (k < 1) requestAnimationFrame(step);
    })(start);
  }

  /* ---------- trips data (home list, course catalog, trip cards) ---------- */
  const upList = $('#upList'), catalog = $('#catalog'), list = $('#tripList'), instList = $('#instList');
  let trips = [], payments = 'demo';
  const slugify = (s) => String(s || '').toLowerCase().replace(/^dr\.?\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const initials = (n) => ((n || '').replace(/\b(Golf|Club|The)\b/g, '').match(/[A-Z]/g) || ['C']).slice(0, 2).join('');

  const upHtml = (t) => {
    const out = t.status === 'soldout', few = !out && t.spotsLeft <= 5;
    const [, m1, d1] = t.startDate.split('-').map(Number), [, m2, d2] = t.endDate.split('-').map(Number);
    return `
    <a class="up rv" href="/trips#trip-${esc(t.id)}" data-img="${esc(t.image)}">
      <span class="up-date"><b>${MONTHS[m1 - 1]}</b><i>${m1 === m2 ? `${d1}–${d2}` : `${d1} – ${MONTHS[m2 - 1]} ${d2}`}</i></span>
      <span class="up-club"><b>${esc(t.club || t.name)}</b><small>${esc(t.location)}</small></span>
      <span class="up-course">${esc(t.courseTitle)}<small>${esc(t.instructor)}</small></span>
      <span class="up-ce"><b>${esc(t.credits)}</b>CE hrs</span>
      <span class="up-spots ${out ? 'out' : few ? 'few' : ''}">${out ? 'Sold out' : few ? `${t.spotsLeft} left` : 'Open'}</span>
      <span class="up-go" aria-hidden="true">→</span>
    </a>`;
  };
  const courseHtml = (t) => `
    <article class="course">
      <p class="course-code">${esc(t.courseCode || 'CE')}</p>
      <p class="course-hrs"><b>${esc(t.credits)}</b>CE hours</p>
      <h3>${esc(t.courseTitle)}</h3>
      <p class="course-fac">${esc(t.instructor)}${t.courseFormat ? ` · ${esc(t.courseFormat)}` : ''}</p>
      ${t.courseSummary ? `<p class="course-sum">${esc(t.courseSummary)}</p>` : ''}
      ${t.courseTopics ? `<ul>${t.courseTopics.split(/\n+/).filter(Boolean).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      <p class="course-foot"><span>${esc(t.club || t.location)}<br>${esc(dates(t.startDate, t.endDate))}</span><a href="/trips#trip-${esc(t.id)}">See the trip →</a></p>
    </article>`;
  // Instructors page: people come from /instructors.json, their courses from the trips they teach
  function renderInstructors(upcoming) {
    fetch('/instructors.json').then((r) => r.json()).then((people) => {
      if (!people.length) { instList.innerHTML = '<p class="empty">Instructors for the next season will be posted here.</p>'; return; }
      instList.innerHTML = people.map((p) => {
        const teaching = upcoming.filter((t) => slugify(t.instructor) === slugify(p.name));
        const ini = (p.name.replace(/^dr\.?\s+/i, '').match(/\b[A-Z]/g) || ['?']).slice(0, 2).join('');
        return `
        <article class="inst rv" id="${slugify(p.name)}">
          <div class="inst-photo">${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : `<span aria-hidden="true">${esc(ini)}</span>`}</div>
          <div class="inst-body">
            ${p.specialties ? `<p class="kicker">${esc(p.specialties)}</p>` : ''}
            <h2>${esc(p.name)}${p.credentials ? `<small>${esc(p.credentials)}</small>` : ''}</h2>
            ${p.title ? `<p class="inst-title">${esc(p.title)}</p>` : ''}
            ${p.bio ? p.bio.split(/\n+/).filter(Boolean).map((para) => `<p class="inst-bio">${esc(para)}</p>`).join('') : '<p class="inst-bio inst-soon">Full bio coming soon.</p>'}
            ${p.cv && p.cv.length ? `<details class="inst-cv"><summary>Curriculum vitae</summary>${p.cv.map((s) => `
              <h3>${esc(s.heading)}</h3><ul>${(s.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}</ul>`).join('')}
              ${p.cvFile ? `<a class="inst-cv-file" href="${esc(p.cvFile)}" download>Download CV (Word)</a>` : ''}</details>` : ''}
            ${teaching.length ? `<div class="inst-teach"><h3>Teaching</h3><ul>${teaching.map((t) => `
              <li><a href="/trips#trip-${esc(t.id)}"><b>${esc(t.courseTitle)}</b><span>${esc(t.club || t.name)} · ${esc(dates(t.startDate, t.endDate))} · ${esc(t.credits)} CE hours</span></a></li>`).join('')}</ul></div>` : ''}
          </div>
        </article>`;
      }).join('');
      watch(instList);
      kick();
      const target = location.hash && document.getElementById(location.hash.slice(1));
      if (target) scrollTo({ top: target.getBoundingClientRect().top + scrollY - 100, behavior: 'instant' });
    }).catch(() => { instList.innerHTML = '<p class="empty">The instructor list could not be loaded. Please refresh.</p>'; });
  }

  const stamp = (t, i) => `
    <div class="stamp" aria-hidden="true"><svg viewBox="0 0 200 200">
      <defs><path id="ring-${i}" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>
      <g class="stamp-spin"><text><textPath href="#ring-${i}" textLength="478" lengthAdjust="spacing">${esc(`${t.club || t.name} ✦ ${t.location} ✦ `.toUpperCase())}</textPath></text></g>
      <text class="stamp-init" x="100" y="122">${esc(initials(t.club || t.name))}</text>
    </svg></div>`;
  const tripHtml = (t, i, total) => {
    const out = t.status === 'soldout', few = !out && t.spotsLeft <= 5;
    const pct = t.capacity ? Math.round((t.booked / t.capacity) * 100) : 0;
    const facts = [['Design', t.architect], ['Par', t.par || ''], ['Yards', t.yards ? Number(t.yards).toLocaleString('en-US') : ''], ['Style', t.style]].filter((f) => f[1]);
    return `
    <article class="tcard" id="trip-${esc(t.id)}" style="--i:${i}">
      <div class="tcard-in">
        <div class="tcard-photo">
          ${t.image ? `<img src="${esc(t.image)}" alt="The course at ${esc(t.club || t.location)}" loading="lazy">` : ''}
          <span class="tcard-no"><b>${String(i + 1).padStart(2, '0')}</b> / ${String(total).padStart(2, '0')}</span>
          ${stamp(t, i)}
          <h2 class="tcard-club">${esc(t.club || t.name)}</h2>
          <p class="tcard-loc">${esc(t.location)}${t.tagline ? ` <span class="pencil">${esc(t.tagline)}</span>` : ''}</p>
          ${t.blurb ? `<p class="tcard-blurb">${esc(t.blurb)}</p>` : ''}
          ${facts.length ? `<dl class="holecard">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        </div>
        <div class="ticket">
          <p class="ticket-event">${esc(t.name)}</p>
          <p class="ticket-dates">${esc(dates(t.startDate, t.endDate))}</p>
          <dl class="ticket-rows">
            <div><dt>Course</dt><dd>${esc(t.courseTitle)}<small>${t.instructor ? `<a href="/instructors#${slugify(t.instructor)}">${esc(t.instructor)}</a>` : ''}</small></dd></div>
            <div><dt>Credits</dt><dd>${esc(t.credits)} CE hours${t.courseFormat ? `<small>${esc(t.courseFormat)}</small>` : ''}</dd></div>
            ${t.golf ? `<div><dt>Golf</dt><dd>${esc(t.golf)}</dd></div>` : ''}
            ${t.lodging ? `<div><dt>Stay</dt><dd>${esc(t.lodging)}</dd></div>` : ''}
          </dl>
          ${t.itinerary || t.travel ? `
          <details class="ticket-days">
            <summary>Day by day &amp; travel</summary>
            ${t.itinerary ? `<ol>${t.itinerary.split(/\n+/).filter(Boolean).map((line) => {
              const k = line.indexOf(':');
              return k > 0 ? `<li><b>${esc(line.slice(0, k))}</b>${esc(line.slice(k + 1).trim())}</li>` : `<li>${esc(line)}</li>`;
            }).join('')}</ol>` : ''}
            ${t.travel ? `<p class="ticket-travel"><b>Getting there</b>${esc(t.travel)}</p>` : ''}
          </details>` : ''}
          <div class="ticket-buy">
            <div class="ticket-price"><b>${money(t.price)}</b><span>per person: stay, golf, food,<br>drinks and CE. Travel not included.${t.deposit > 0 ? `<br>${money(t.deposit)} deposit` : ''}</span></div>
            <div class="meter"><i data-w="${pct}"></i></div>
            <p class="meter-l"><span>${esc(t.booked)} of ${esc(t.capacity)} taken</span><span class="${few ? 'few' : ''}">${out ? 'Full' : few ? `Only ${t.spotsLeft} left` : `${t.spotsLeft} open`}</span></p>
            <button class="btn btn-flag btn-wide" data-reserve="${esc(t.id)}" ${out ? 'disabled' : ''}><span>${out ? 'Sold out' : t.deposit > 0 ? 'Reserve with deposit' : 'Reserve a spot'}</span></button>
          </div>
        </div>
      </div>
    </article>`;
  };

  if (upList || catalog || list || instList) {
    const visibleTrips = (all) => all.filter((t) => t.status === 'published' || t.status === 'soldout').map((t) => {
      const spotsLeft = Math.max(0, (t.capacity || 0) - (t.booked || 0));
      return { ...t, spotsLeft, status: t.status === 'soldout' || spotsLeft === 0 ? 'soldout' : 'published' };
    }).sort((a, b) => a.startDate.localeCompare(b.startDate));
    fetch('/api/trips').then((r) => { if (!r.ok) throw new Error('no api'); return r.json(); })
      .catch(() => fetch('/trips.json').then((r) => r.json()).then((all) => ({ trips: visibleTrips(all), payments: 'static' })))
      .then((data) => {
      trips = data.trips || []; payments = data.payments;
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = trips.filter((t) => t.endDate >= today);
      if (upList) {
        upList.innerHTML = upcoming.length ? upcoming.slice(0, 6).map(upHtml).join('') : '<p class="empty">New dates are being set. Check back soon.</p>';
        watch(upList);
      }
      if (catalog) catalog.innerHTML = upcoming.filter((t) => t.courseTitle).map(courseHtml).join('') || '<p class="ce-fine">Courses for the next season will be posted here.</p>';
      if (list) {
        list.innerHTML = upcoming.length ? upcoming.map((t, i) => tripHtml(t, i, upcoming.length)).join('') : '<p class="empty">New dates are being set. Check back soon.</p>';
        cards = $$('.tcard', list).map((el) => ({ el, inner: $('.tcard-in', el), img: $('.tcard-photo img', el) || el }));
        cards.forEach((c) => io.observe(c.el));
        stampEls = $$('.stamp-spin');
      }
      if (instList) renderInstructors(upcoming);
      kick();
      // arriving from a link like /trips#trip-xyz: jump there once the cards exist
      const target = location.hash && document.getElementById(location.hash.slice(1));
      if (target && target.classList.contains('tcard')) { measure(); scrollTo({ top: target.getBoundingClientRect().top + scrollY - 90, behavior: 'instant' }); }
    }).catch(() => {
      const msg = '<p class="empty">The schedule could not be loaded. Please refresh.</p>';
      if (upList) upList.innerHTML = msg;
      if (list) list.innerHTML = msg;
    });
  }

  // home list: the club photo follows the cursor
  const float = $('#upFloat');
  if (upList && float && matchMedia('(hover: hover)').matches && !calm) {
    const img = float.firstElementChild;
    upList.addEventListener('pointermove', (e) => {
      const row = e.target.closest('.up');
      if (!row || !row.dataset.img) { float.classList.remove('on'); return; }
      if (img.getAttribute('src') !== row.dataset.img) img.src = row.dataset.img;
      float.classList.add('on');
      float.style.setProperty('--x', e.clientX + 'px');
      float.style.setProperty('--y', e.clientY + 'px');
      float.style.setProperty('--r', (((e.clientX / innerWidth) - 0.5) * 12).toFixed(1) + 'deg');
    });
    upList.addEventListener('pointerleave', () => float.classList.remove('on'));
  }

  // course catalog: drag sideways with a mouse (touch and trackpads scroll natively)
  if (catalog) {
    let drag = null;
    catalog.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') drag = { x: e.clientX, left: catalog.scrollLeft, moved: false }; });
    addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) { drag.moved = true; catalog.classList.add('drag'); }
      catalog.scrollLeft = drag.left - dx;
    });
    addEventListener('pointerup', () => { if (drag) { catalog.dataset.moved = drag.moved ? '1' : ''; drag = null; setTimeout(() => catalog.classList.remove('drag'), 0); } });
    catalog.addEventListener('click', (e) => { if (catalog.dataset.moved) { e.preventDefault(); catalog.dataset.moved = ''; } }, true);
  }

  /* ---------- reserve dialog (trips page) ---------- */
  const dlg = $('#reserve');
  if (dlg && list) {
    const form = $('#reserveForm'), err = $('#reserveError'), submit = $('#reserveSubmit'), gate = $('#reserveGate');
    let current = null, opener = null;
    const total = () => { $('#reserveTotal').textContent = money(current.deposit * +form.spots.value); };
    list.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-reserve]');
      if (!b) return;
      current = trips.find((t) => t.id === b.dataset.reserve);
      if (!current) return;
      opener = b;
      const u = await meReady;
      $('#reserveLoc').textContent = `${current.club || current.name} · ${current.location}`;
      $('#reserveTitle').textContent = current.name;
      $('#reserveMeta').textContent = `${dates(current.startDate, current.endDate)} · ${current.credits} CE hours · ${money(current.price)} per person`;
      form.hidden = !u; gate.hidden = !!u;
      $('#gateSoon').hidden = !isStatic;
      document.querySelectorAll('#reserveGate .btn').forEach((x) => { x.hidden = isStatic; });
      if (!u) {
        const next = encodeURIComponent(`/trips#trip-${current.id}`);
        $('#gateIn').href = `/account?next=${next}`;
        $('#gateUp').href = `/account?mode=signup&next=${next}`;
      } else {
        $('#reserveWho').textContent = `${u.name} · ${u.email}`;
        [...form.spots.options].forEach((o) => { o.disabled = +o.value > current.spotsLeft; });
        form.spots.value = '1';
        err.textContent = '';
        $('#reserveFine').textContent = payments === 'live'
          ? "You'll be taken to Stripe to pay the deposit securely."
          : 'Preview mode: payments are not connected yet, so no card will be charged.';
        total();
      }
      dlg.showModal();
    });
    form.spots.addEventListener('change', total);
    dlg.addEventListener('close', () => { if (opener) opener.focus(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true; submit.firstElementChild.textContent = 'One moment…';
      try {
        const r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tripId: current.id, spots: +form.spots.value }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Something went wrong.');
        location.href = data.url;
      } catch (ex) {
        err.textContent = ex.message;
        submit.disabled = false; submit.firstElementChild.textContent = 'Continue to secure payment';
      }
    });
  }
})();
