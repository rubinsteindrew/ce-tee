// CE & Tee — site server. No dependencies: run with `node server.js`.
//
// - Serves the pages in /public (clean URLs: /trips -> trips.html).
// - Stores trips, accounts and reservations as JSON files in DATA_DIR (default ./data).
// - Accounts: sign up, verify email, sign in, reset password.
//   A verified account whose email ends in @ADMIN_DOMAIN can use /admin.
// - Deposits go through Stripe Checkout once STRIPE_SECRET_KEY is set.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

// ---- config (.env, then real environment variables win) -----------------
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = (k, d = '') => process.env[k] || d;
const PORT = Number(env('PORT')) || 4173;
const DATA = path.resolve(ROOT, env('DATA_DIR', 'data'));
const ADMIN_DOMAIN = env('ADMIN_DOMAIN', 'ce-tee.com').toLowerCase().replace(/^@/, '');
const SESSION_SECRET = env('SESSION_SECRET');
const RESEND_API_KEY = env('RESEND_API_KEY');
const MAIL_FROM = env('MAIL_FROM', 'CE & Tee <support@' + ADMIN_DOMAIN + '>');
const STRIPE_SECRET_KEY = env('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = env('STRIPE_WEBHOOK_SECRET');
const SITE_URL = env('SITE_URL').replace(/\/$/, '');
const GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET');
const SESSION_DAYS = 30;
// Deposit per spot, in dollars. A trip can set its own; one left at 0 uses this.
const DEFAULT_DEPOSIT = Number(env('DEFAULT_DEPOSIT')) || 1000;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET is missing or too short. Set a long random value in .env or the environment.');
  process.exit(1);
}

// ---- storage ---------------------------------------------------------------
fs.mkdirSync(DATA, { recursive: true });
const FILES = {
  trips: path.join(DATA, 'trips.json'),
  users: path.join(DATA, 'users.json'),
  reservations: path.join(DATA, 'reservations.json'),
  tokens: path.join(DATA, 'tokens.json'),
};
// photos and logos uploaded from the admin desk live beside the data (on Render, the persistent disk),
// so a redeploy of the code never wipes them. Served at /uploads/<file>.
const UPLOADS = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const IMG_PATH = String.raw`\/img\/(?:logos\/)?[\w.-]+|\/uploads\/[\w.-]+|https:\/\/[^\s"'<>]+`;
const imageType = (b) => (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'png'
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg'
  : b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : '');
// first run on a fresh disk: start from the sample trips that ship with the code
if (!fs.existsSync(FILES.trips) && fs.existsSync(path.join(ROOT, 'data', 'trips.sample.json'))) {
  fs.copyFileSync(path.join(ROOT, 'data', 'trips.sample.json'), FILES.trips);
}
const read = (name) => { try { return JSON.parse(fs.readFileSync(FILES[name], 'utf8')); } catch { return []; } };
const write = (name, value) => {
  const tmp = FILES[name] + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, FILES[name]);
};

// ---- trips -----------------------------------------------------------------
const TRIP_FIELDS = {
  name: 'string', club: 'string', location: 'string', startDate: 'string', endDate: 'string', image: 'string',
  tagline: 'string', blurb: 'string', itinerary: 'string', travel: 'string', architect: 'string', style: 'string', golf: 'string', lodging: 'string',
  courseCode: 'string', courseTitle: 'string', courseFormat: 'string', courseSummary: 'string', courseTopics: 'string',
  instructor: 'string', status: 'string', industry: 'string', logo: 'string',
  par: 'number', yards: 'number', credits: 'number', rounds: 'number',
  price: 'number', deposit: 'number', capacity: 'number', booked: 'number',
};
const STATUSES = ['published', 'draft', 'soldout', 'archived'];
function cleanTrip(input, base = {}) {
  const trip = { ...base };
  for (const [key, type] of Object.entries(TRIP_FIELDS)) {
    if (input[key] === undefined) continue;
    if (type === 'number') { const n = Number(input[key]); trip[key] = Number.isFinite(n) && n >= 0 ? n : 0; }
    else trip[key] = String(input[key]).slice(0, 3000).trim();
  }
  if (!STATUSES.includes(trip.status)) trip.status = 'draft';
  // which profession the trip is for (an id from public/industries.json); older trips are dentistry
  trip.industry = /^[a-z0-9-]{1,40}$/.test(trip.industry || '') ? trip.industry : 'dentistry';
  if (!trip.name) throw new Error('A trip needs an event name.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(trip.endDate || '')) throw new Error('A trip needs a start and end date.');
  if (trip.endDate < trip.startDate) throw new Error('The last day is before the first day.');
  if (trip.image && !new RegExp(`^(${IMG_PATH})$`).test(trip.image)) throw new Error('The photo must be from the library, an upload or an https:// link.');
  if (trip.logo && !new RegExp(`^(${IMG_PATH})$`).test(trip.logo)) throw new Error('The club logo must be from the logo list, an upload or an https:// link.');
  return trip;
}
const visible = (t) => t.status === 'published' || t.status === 'soldout';
const publicTrip = (t) => {
  const spotsLeft = Math.max(0, (t.capacity || 0) - (t.booked || 0));
  return { ...t, deposit: t.deposit > 0 ? t.deposit : DEFAULT_DEPOSIT, spotsLeft, status: t.status === 'soldout' || spotsLeft === 0 ? 'soldout' : 'published' };
};

// ---- accounts --------------------------------------------------------------
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 200;
const isAdmin = (u) => !!u && u.verified && u.email.endsWith('@' + ADMIN_DOMAIN);
const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, practice: u.practice || '', phone: u.phone || '', verified: !!u.verified, admin: isAdmin(u), google: !!u.googleId, hasPassword: !!u.hash, createdAt: u.createdAt });

const scrypt = (password, salt) => new Promise((res, rej) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k.toString('hex')))));
async function hashPassword(password) { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: await scrypt(password, salt) }; }
async function checkPassword(user, password) { if (!user.hash) return false; const hash = await scrypt(password, user.salt); return safeEqual(hash, user.hash); }
const passwordProblem = (p) => (typeof p !== 'string' || p.length < 10 ? 'Use a password of at least 10 characters.' : p.length > 200 ? 'That password is too long.' : '');

// sessions: signed cookie "userId.version.expiry.signature"; bumping a user's version signs them out everywhere
const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
const makeSession = (u) => { const body = `${u.id}.${u.sessionVersion || 0}.${Date.now() + SESSION_DAYS * 864e5}`; return `${body}.${sign(body)}`; };
function currentUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  if (!safeEqual(sig, sign(`${id}.${ver}.${exp}`)) || Number(exp) < Date.now()) return null;
  const u = read('users').find((x) => x.id === id);
  return u && String(u.sessionVersion || 0) === ver ? u : null;
}
const secureCookie = (req) => (req.headers['x-forwarded-proto'] === 'https' || SITE_URL.startsWith('https://') ? '; Secure' : '');
const sessionCookie = (req, u) => `ce_session=${makeSession(u)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secureCookie(req)}`;
const clearCookie = (req) => `ce_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(req)}`;

// one-time email tokens (verification, password reset); only a hash is stored
function issueToken(userId, type, hours) {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokens = read('tokens').filter((t) => t.exp > Date.now() && !(t.userId === userId && t.type === type));
  tokens.push({ hash: crypto.createHash('sha256').update(raw).digest('hex'), userId, type, exp: Date.now() + hours * 36e5 });
  write('tokens', tokens);
  return raw;
}
function useToken(raw, type) {
  const hash = crypto.createHash('sha256').update(String(raw || '')).digest('hex');
  const tokens = read('tokens');
  const t = tokens.find((x) => x.hash === hash && x.type === type && x.exp > Date.now());
  if (!t) return null;
  write('tokens', tokens.filter((x) => x !== t));
  return t.userId;
}

async function sendMail(to, subject, text) {
  if (!RESEND_API_KEY) {
    console.log(`\n--- email (not sent: RESEND_API_KEY is not set) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---------------------------------------------------\n`);
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
  });
  if (!r.ok) console.error('Email failed:', r.status, await r.text().catch(() => ''));
}
const sendVerify = (req, u) => sendMail(u.email, 'Confirm your CE & Tee account',
  `Hi ${u.name.split(' ')[0]},\n\nConfirm your email to finish setting up your CE & Tee account:\n\n${baseUrl(req)}/account?verify=${issueToken(u.id, 'verify', 48)}\n\nThis link works for 48 hours. If you didn't sign up, you can ignore this email.`);

// ---- helpers ---------------------------------------------------------------
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req, limit = 200_000) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const jsonBody = async (req) => { try { return JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return null; } };
const safeEqual = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const baseUrl = (req) => SITE_URL || `http://${req.headers.host}`;
// Google must send people back to the host they started on (ce-tee.onrender.com, ce-tee.com or localhost),
// and every one of those callback URLs has to be listed on the Google OAuth client.
const googleRedirect = (req) => `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}/api/auth/google/callback`;
const redirect = (res, location, cookies) => {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookies ? { 'Set-Cookie': cookies } : {}) });
  res.end();
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'trip';
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

// simple fixed-window limiter for sign-in style routes
const hits = new Map();
function limited(req, key, max = 10, windowMs = 15 * 60_000) {
  const k = key + '|' + clientIp(req), now = Date.now();
  const h = hits.get(k);
  if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + windowMs }); return false; }
  h.n += 1;
  return h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60_000).unref();

function recordReservation(entry) {
  const reservations = read('reservations');
  if (entry.stripeSession && reservations.some((r) => r.stripeSession === entry.stripeSession)) return;
  reservations.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry });
  write('reservations', reservations);
  const trips = read('trips');
  const trip = trips.find((t) => t.id === entry.tripId);
  if (trip) { trip.booked = (trip.booked || 0) + entry.spots; write('trips', trips); }
}

// ---- API -------------------------------------------------------------------
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  // Requests that change something must come from this site (blocks cross-site form posts).
  if (req.method !== 'GET' && url.pathname !== '/api/stripe/webhook') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Cross-site request blocked.' });
  }

  if (route === 'GET /api/trips') {
    const trips = read('trips').filter(visible).map(publicTrip).sort((a, b) => a.startDate.localeCompare(b.startDate));
    return send(res, 200, { trips, payments: STRIPE_SECRET_KEY ? 'live' : 'demo' });
  }

  // ---- auth ----
  if (route === 'GET /api/auth/me') return send(res, 200, { user: publicUser(currentUser(req)), google: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });

  if (route === 'POST /api/auth/signup') {
    if (limited(req, 'signup', 8)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const b = await jsonBody(req) || {};
    const name = String(b.name || '').trim().slice(0, 120), email = normEmail(b.email);
    if (!name) return send(res, 400, { error: 'Please enter your name.' });
    if (!validEmail(email)) return send(res, 400, { error: 'Please enter a valid email.' });
    const problem = passwordProblem(b.password);
    if (problem) return send(res, 400, { error: problem });
    const users = read('users');
    if (users.some((u) => u.email === email)) return send(res, 409, { error: 'An account with that email already exists. Try signing in.' });
    const { salt, hash } = await hashPassword(b.password);
    const user = {
      id: crypto.randomUUID(), name, email, salt, hash, verified: false, sessionVersion: 0, createdAt: new Date().toISOString(),
      practice: String(b.practice || '').trim().slice(0, 160), phone: String(b.phone || '').trim().slice(0, 40),
    };
    users.push(user); write('users', users);
    await sendVerify(req, user);
    return send(res, 201, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, user) });
  }

  if (route === 'POST /api/auth/login') {
    const b = await jsonBody(req) || {};
    const email = normEmail(b.email);
    if (limited(req, 'login', 10) || limited(req, 'login:' + email, 6)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const user = read('users').find((u) => u.email === email);
    if (user && !user.hash) return send(res, 401, { error: 'This account signs in with Google. Use the Google button above.' });
    const ok = user ? await checkPassword(user, String(b.password || '')) : (await scrypt('x', 'pad'), false);
    if (!ok) return send(res, 401, { error: 'That email and password don\'t match.' });
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, user) });
  }

  if (route === 'POST /api/auth/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });

  // ---- Sign in with Google (OAuth authorization-code flow, server side) ----
  if (route === 'GET /api/auth/google') {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return redirect(res, '/account?error=google-off');
    const next = String(url.searchParams.get('next') || '');
    const state = crypto.randomBytes(24).toString('hex');
    const value = `${state}.${Buffer.from(/^\/(?!\/)/.test(next) ? next : '').toString('base64url')}`;
    const q = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: googleRedirect(req), response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
    });
    return redirect(res, 'https://accounts.google.com/o/oauth2/v2/auth?' + q,
      `ce_oauth=${value}.${sign(value)}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600${secureCookie(req)}`);
  }

  if (route === 'GET /api/auth/google/callback') {
    const done = `ce_oauth=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0${secureCookie(req)}`;
    const fail = (why) => redirect(res, '/account?error=' + why, done);
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)ce_oauth=([^;]+)/);
    const [state, nextB64, sig] = m ? m[1].split('.') : [];
    if (!state || !safeEqual(sig, sign(`${state}.${nextB64}`)) || !safeEqual(state, url.searchParams.get('state') || '')) return fail('google-state');
    if (url.searchParams.get('error') || !url.searchParams.get('code')) return fail('google-cancelled');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: googleRedirect(req), grant_type: 'authorization_code' }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) { console.error('Google token exchange failed:', r.status, tok.error || ''); return fail('google-failed'); }
    // The ID token came straight from Google over TLS, so its claims can be read without re-checking the signature
    // (Google's guidance for the server-side code flow); the audience, issuer and expiry are still checked.
    let c; try { c = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8')); } catch { return fail('google-failed'); }
    if (c.aud !== GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss) || c.exp * 1000 < Date.now()) return fail('google-failed');
    const email = normEmail(c.email);
    if (!c.email_verified || !validEmail(email)) return fail('google-unverified');
    const users = read('users');
    let u = users.find((x) => x.googleId === c.sub) || users.find((x) => x.email === email);
    if (!u) {
      u = { id: crypto.randomUUID(), name: String(c.name || email.split('@')[0]).slice(0, 120), email, verified: true, sessionVersion: 0, createdAt: new Date().toISOString(), practice: '', phone: '' };
      users.push(u);
    } else if (!u.verified) {
      // someone signed up with this address but never proved they own it; Google just did, so drop that unproven password
      delete u.salt; delete u.hash; u.sessionVersion = (u.sessionVersion || 0) + 1;
    }
    Object.assign(u, { googleId: c.sub, verified: true });
    if (!u.picture && c.picture) u.picture = String(c.picture).slice(0, 500);
    write('users', users);
    let next = ''; try { next = Buffer.from(nextB64 || '', 'base64url').toString('utf8'); } catch { /* ignore */ }
    return redirect(res, /^\/(?!\/)/.test(next) ? next : '/account', [done, sessionCookie(req, u)]);
  }

  if (route === 'POST /api/auth/verify') {
    const b = await jsonBody(req) || {};
    const id = useToken(b.token, 'verify');
    if (!id) return send(res, 400, { error: 'That confirmation link has expired or was already used.' });
    const users = read('users'), u = users.find((x) => x.id === id);
    if (!u) return send(res, 400, { error: 'Account not found.' });
    u.verified = true; write('users', users);
    return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': sessionCookie(req, u) });
  }

  if (route === 'POST /api/auth/resend') {
    const u = currentUser(req);
    if (!u) return send(res, 401, { error: 'Please sign in.' });
    if (u.verified) return send(res, 200, { ok: true });
    if (limited(req, 'resend', 4)) return send(res, 429, { error: 'Please wait a few minutes before asking again.' });
    await sendVerify(req, u);
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/auth/forgot') {
    if (limited(req, 'forgot', 5)) return send(res, 429, { error: 'Please wait a few minutes before asking again.' });
    const b = await jsonBody(req) || {};
    const u = read('users').find((x) => x.email === normEmail(b.email));
    if (u) {
      await sendMail(u.email, 'Reset your CE & Tee password',
        `Hi ${u.name.split(' ')[0]},\n\nUse this link to choose a new password:\n\n${baseUrl(req)}/account?reset=${issueToken(u.id, 'reset', 1)}\n\nIt works for one hour. If you didn't ask for this, you can ignore this email.`);
    }
    return send(res, 200, { ok: true });   // same answer either way, so emails can't be probed
  }

  if (route === 'POST /api/auth/reset') {
    const b = await jsonBody(req) || {};
    const problem = passwordProblem(b.password);
    if (problem) return send(res, 400, { error: problem });
    const id = useToken(b.token, 'reset');
    if (!id) return send(res, 400, { error: 'That reset link has expired or was already used.' });
    const users = read('users'), u = users.find((x) => x.id === id);
    if (!u) return send(res, 400, { error: 'Account not found.' });
    Object.assign(u, await hashPassword(b.password), { verified: true, sessionVersion: (u.sessionVersion || 0) + 1 });
    write('users', users);
    return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': sessionCookie(req, u) });
  }

  // ---- signed-in member ----
  if (url.pathname.startsWith('/api/account/')) {
    const me = currentUser(req);
    if (!me) return send(res, 401, { error: 'Please sign in.' });
    if (route === 'GET /api/account/reservations') {
      const trips = read('trips');
      const mine = read('reservations').filter((r) => r.userId === me.id || r.email === me.email)
        .map((r) => { const t = trips.find((x) => x.id === r.tripId) || {}; return { ...r, trip: { name: t.name || r.tripName, club: t.club, location: t.location, startDate: t.startDate, endDate: t.endDate, courseTitle: t.courseTitle, credits: t.credits, image: t.image, price: t.price } }; })
        .sort((a, b) => (a.trip.startDate || '').localeCompare(b.trip.startDate || ''));
      return send(res, 200, { reservations: mine });
    }
    if (route === 'PUT /api/account/profile') {
      const b = await jsonBody(req) || {};
      const users = read('users'), u = users.find((x) => x.id === me.id);
      if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 120); if (!n) return send(res, 400, { error: 'Your name can\'t be empty.' }); u.name = n; }
      if (b.practice !== undefined) u.practice = String(b.practice).trim().slice(0, 160);
      if (b.phone !== undefined) u.phone = String(b.phone).trim().slice(0, 40);
      write('users', users);
      return send(res, 200, { user: publicUser(u) });
    }
    if (route === 'POST /api/account/password') {
      const b = await jsonBody(req) || {};
      if (me.hash && !(await checkPassword(me, String(b.current || '')))) return send(res, 400, { error: 'Your current password is wrong.' });
      const problem = passwordProblem(b.password);
      if (problem) return send(res, 400, { error: problem });
      const users = read('users'), u = users.find((x) => x.id === me.id);
      Object.assign(u, await hashPassword(b.password), { sessionVersion: (u.sessionVersion || 0) + 1 });
      write('users', users);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, u) });
    }
    return send(res, 404, { error: 'Not found.' });
  }

  // ---- deposit checkout (members only) ----
  if (route === 'POST /api/checkout') {
    const me = currentUser(req);
    if (!me) return send(res, 401, { error: 'Please sign in to reserve.' });
    const b = await jsonBody(req) || {};
    const trip = read('trips').filter(visible).map(publicTrip).find((t) => t.id === b.tripId);
    const spots = Math.floor(Number(b.spots));
    if (!trip) return send(res, 404, { error: 'That trip is no longer available.' });
    if (!(spots >= 1 && spots <= 4)) return send(res, 400, { error: 'You can reserve between 1 and 4 spots.' });
    if (spots > trip.spotsLeft) return send(res, 409, { error: trip.spotsLeft ? `Only ${trip.spotsLeft} spot(s) left on this trip.` : 'This trip is sold out.' });

    if (!STRIPE_SECRET_KEY) {
      recordReservation({ tripId: trip.id, tripName: trip.name, userId: me.id, name: me.name, email: me.email, spots, deposit: trip.deposit * spots, demo: true });
      return send(res, 200, { url: `/reserved?demo=1&trip=${encodeURIComponent(trip.name)}` });
    }
    const form = new URLSearchParams({
      mode: 'payment',
      customer_email: me.email,
      success_url: `${baseUrl(req)}/reserved?trip=${encodeURIComponent(trip.name)}`,
      cancel_url: `${baseUrl(req)}/trips`,
      'line_items[0][quantity]': String(spots),
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(Math.round(trip.deposit * 100)),
      'line_items[0][price_data][product_data][name]': `Deposit: ${trip.name}${trip.club ? ' at ' + trip.club : ''}`,
      'line_items[0][price_data][product_data][description]': `${trip.startDate} to ${trip.endDate} · ${trip.credits} CE credits`,
      'metadata[tripId]': trip.id, 'metadata[tripName]': trip.name, 'metadata[spots]': String(spots),
      'metadata[userId]': me.id, 'metadata[name]': me.name,
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
    const session = await r.json();
    if (!r.ok) { console.error('Stripe error:', session.error && session.error.message); return send(res, 502, { error: 'Checkout is unavailable right now. Please try again shortly.' }); }
    return send(res, 200, { url: session.url });
  }

  if (route === 'POST /api/stripe/webhook') {
    const raw = await readBody(req, 1_000_000);
    if (!STRIPE_WEBHOOK_SECRET) return send(res, 400, { error: 'Webhook not configured.' });
    const header = String(req.headers['stripe-signature'] || '');
    const t = (header.match(/t=(\d+)/) || [])[1];
    const sigs = [...header.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]);
    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.${raw.toString('utf8')}`).digest('hex');
    if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300 || !sigs.some((s) => safeEqual(s, expected))) return send(res, 400, { error: 'Bad signature.' });
    let event; try { event = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'Bad body.' }); }
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object, md = s.metadata || {};
      if (md.tripId) recordReservation({
        tripId: md.tripId, tripName: md.tripName || '', userId: md.userId || '', name: md.name || '',
        email: s.customer_email || (s.customer_details && s.customer_details.email) || '',
        spots: Number(md.spots) || 1, deposit: (s.amount_total || 0) / 100, stripeSession: s.id, demo: false,
      });
    }
    return send(res, 200, { received: true });
  }

  // ---- admin (verified @ADMIN_DOMAIN accounts) ----
  if (url.pathname.startsWith('/api/admin/')) {
    const me = currentUser(req);
    if (!me) return send(res, 401, { error: 'Please sign in.' });
    if (!isAdmin(me)) return send(res, 403, { error: `Admin pages are for verified @${ADMIN_DOMAIN} accounts.` });

    if (route === 'GET /api/admin/overview') {
      const pics = (dir, url) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => `${url}/${f}`);
      const uploaded = pics(UPLOADS, '/uploads');
      const images = [...pics(path.join(PUBLIC, 'img'), '/img'), ...uploaded.filter((u) => u.includes('/photo-'))];
      const logos = [...pics(path.join(PUBLIC, 'img', 'logos'), '/img/logos'), ...uploaded.filter((u) => u.includes('/logo-'))];
      const users = read('users').map(publicUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return send(res, 200, { trips: read('trips'), reservations: read('reservations'), users, images, logos, adminDomain: ADMIN_DOMAIN, payments: STRIPE_SECRET_KEY ? 'live' : 'demo' });
    }
    // upload a course photo or club logo: the raw file is the request body, ?kind=photo|logo
    if (route === 'POST /api/admin/upload') {
      const kind = url.searchParams.get('kind') === 'logo' ? 'logo' : 'photo';
      let buf; try { buf = await readBody(req, 8_000_000); } catch { return send(res, 413, { error: 'That file is too big. Keep it under 8 MB.' }); }
      const ext = imageType(buf);
      if (!ext) return send(res, 400, { error: 'Upload a JPG, PNG or WebP image.' });
      const name = `${kind}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS, name), buf);
      return send(res, 201, { url: `/uploads/${name}` });
    }
    if (route === 'POST /api/admin/trips') {
      const b = await jsonBody(req);
      if (!b) return send(res, 400, { error: 'Bad request.' });
      let trip; try { trip = cleanTrip(b, { booked: 0 }); } catch (e) { return send(res, 400, { error: e.message }); }
      const trips = read('trips');
      let id = slug(`${trip.name}-${trip.startDate.slice(0, 4)}`);
      while (trips.some((t) => t.id === id)) id += '-' + crypto.randomBytes(2).toString('hex');
      trip.id = id; trip.updatedBy = me.email; trip.updatedAt = new Date().toISOString();
      trips.push(trip); write('trips', trips);
      return send(res, 201, { trip });
    }
    const m = url.pathname.match(/^\/api\/admin\/trips\/([a-z0-9-]+)$/);
    if (m) {
      const trips = read('trips'), i = trips.findIndex((t) => t.id === m[1]);
      if (i < 0) return send(res, 404, { error: 'Trip not found.' });
      if (req.method === 'PUT') {
        const b = await jsonBody(req);
        if (!b) return send(res, 400, { error: 'Bad request.' });
        try { trips[i] = { ...cleanTrip(b, trips[i]), id: trips[i].id, updatedBy: me.email, updatedAt: new Date().toISOString() }; } catch (e) { return send(res, 400, { error: e.message }); }
        write('trips', trips);
        return send(res, 200, { trip: trips[i] });
      }
      if (req.method === 'DELETE') {
        if (trips[i].status !== 'archived') return send(res, 400, { error: 'Archive a trip before deleting it.' });
        if (read('reservations').some((r) => r.tripId === trips[i].id)) return send(res, 400, { error: 'This trip has reservations, so it stays in the archive.' });
        trips.splice(i, 1); write('trips', trips);
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Not found.' });
  }

  return send(res, 404, { error: 'Not found.' });
}

// ---- static files ------------------------------------------------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (rel === '/') rel = '/index.html';
  else if (!path.extname(rel)) rel = rel.replace(/\/+$/, '') + '.html';
  if (rel.endsWith('.html') && url.pathname.endsWith('.html') && rel !== '/index.html') {   // /trips.html -> /trips
    res.writeHead(301, { Location: url.pathname.slice(0, -5) + url.search }); return res.end();
  }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      const nf = path.join(PUBLIC, '404.html');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.existsSync(nf) ? fs.createReadStream(nf).pipe(res) : res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': /\.(jpe?g|png|webp|woff2)$/.test(ext) ? 'public, max-age=3600' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...(ext === '.html' ? { 'X-Frame-Options': 'DENY' } : {}),
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/uploads/')) {   // admin uploads, from the data folder
      const name = url.pathname.slice('/uploads/'.length);
      const file = path.join(UPLOADS, name);
      if (!/^[\w.-]+\.(png|jpg|webp)$/.test(name) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES['.' + name.split('.').pop()], 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
  }
}).listen(PORT, () => {
  console.log(`CE & Tee running at http://localhost:${PORT}`);
  console.log(`Data folder:  ${DATA}`);
  console.log(`Admins:       verified @${ADMIN_DOMAIN} accounts`);
  console.log(`Email:        ${RESEND_API_KEY ? 'sending through Resend' : 'printed here in the log (RESEND_API_KEY not set)'}`);
  console.log(`Google:       ${GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? 'Sign in with Google is on' : 'off (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set)'}`);
  console.log(`Payments:     ${STRIPE_SECRET_KEY ? 'Stripe connected' : 'preview mode (STRIPE_SECRET_KEY not set)'}`);
});
