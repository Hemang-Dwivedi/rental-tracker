// Orchestrates a capture run from a persistent extension page (MV3 service
// workers get killed mid-run; a visible page with normal timers does not).
const ALLOWED = ['www.nobroker.in', 'www.99acres.com', 'housing.com', 'www.housing.com', 'www.magicbricks.com', 'www.squareyards.com'];
const logEl = document.getElementById('log');
const log = (s, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = new Date().toTimeString().slice(0, 8) + '  ' + s; logEl.appendChild(d); };
const zz = ms => new Promise(r => setTimeout(r, ms));
let aborted = false, currentTab = null;
// closing the runner mid-run kills the run - don't orphan the portal tab it was driving
window.addEventListener('beforeunload', () => { if (currentTab) try { chrome.tabs.remove(currentTab); } catch (_) {} });
document.getElementById('stop').onclick = () => { aborted = true; if (currentTab) chrome.tabs.sendMessage(currentTab, { cmd: 'nbtb-stopscroll' }).catch(() => {}); log('stopping after current page…'); };

// "…page-{1-5}" expands to five URLs
function expand(u) {
  const m = u.match(/\{(\d+)-(\d+)\}/);
  if (!m) return [u];
  const a = parseInt(m[1], 10), b = parseInt(m[2], 10), out = [];
  for (let i = a; i <= b && out.length < 30; i++) out.push(u.replace(m[0], String(i)));
  return out;
}
function allowed(u) { try { return ALLOWED.includes(new URL(u).hostname); } catch (_) { return false; } }
// 99acres paginates by full page navigation (?page=N, 25 per page) rather than
// infinite scroll. Walk pages until one yields no new listings, then stop.
function is99(u) { try { return new URL(u).hostname.indexOf('99acres') !== -1 && !/[?&]page=\d/.test(u); } catch (_) { return false; } }
function withPage(u, n) { return u + (u.indexOf('?') !== -1 ? '&' : '?') + 'page=' + n; }

function waitComplete(tabId, ms) {
  return new Promise(res => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); res(false); }, ms);
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(fn); res(true); } };
    chrome.tabs.onUpdated.addListener(fn);
  });
}
const pending = () => new Promise(r => chrome.storage.local.get({ captures: [] }, st => r(st.captures.length)));


// ---------------------------------------------------------------------------
// 99acres is the SPINE of an interleaved run: we load one 99acres page, then go
// do a full search on another portal (the "spacer" — its genuinely variable
// duration becomes an organic, non-uniform gap), then come back for the next
// 99acres page. When no spacers remain, a random min–max floor still guarantees
// an irregular minimum gap. This spaces 99acres pages out with real work rather
// than a mechanical clock — but it does NOT lower the per-portal budget, which
// is still the only thing that actually keeps 99acres from blocking us.
// ---------------------------------------------------------------------------
const A99_SPACE_MIN = 6000, A99_SPACE_MAX = 22000;   // random floor between 99acres pages
const a99Rand = () => A99_SPACE_MIN + Math.floor(Math.random() * (A99_SPACE_MAX - A99_SPACE_MIN));
const A99_MAX_PAGES = 120;                            // hard safety rail; budget caps far lower

// Build a stateful walk job for one 99acres locality, resuming if a previous run
// was throttled part-way.
async function a99Init(base) {
  const locKey = (() => { try { return new URL(base).searchParams.get('locality') || ''; } catch (_) { return ''; } })();
  const job = {
    base, locKey, seen: new Set(), nextPg: 1, reported: null,
    retried: false, blocked: false, done: false, visits: 0, progKey: 'a99prog:' + locKey,
    pagesOf(caps) { const s = new Set(); for (const c of caps) { try { const o = new URL(c.url); if (o.hostname.indexOf('99acres') !== -1 && o.searchParams.get('page') && (o.searchParams.get('__loc') || '') === locKey) s.add(o.searchParams.get('page')); } catch (_) {} } return s; },
    mine(caps) { return caps.filter(c => { try { const o = new URL(c.url); return o.hostname.indexOf('99acres') !== -1 && (o.searchParams.get('__loc') || '') === locKey; } catch (_) { return false; } }); }
  };
  try {
    const prog = await new Promise(r => chrome.storage.local.get({ [job.progKey]: null }, s => r(s[job.progKey])));
    if (prog && prog.blocked && prog.maxPage > 1 && (Date.now() - prog.at) < 24 * 3600 * 1000) {
      job.nextPg = prog.maxPage + 1;
      prog.pages.forEach(p => job.seen.add(p));
      log(`  resuming ${new URL(base).pathname} at page ${job.nextPg} — an earlier run captured 1-${prog.maxPage} before being throttled`, 'ok');
    }
  } catch (_) {}
  return job;
}

// Do exactly ONE 99acres page for a job; mutate its state. Returns 'continue',
// 'done', 'blocked', or 'error'.
async function a99Step(job) {
  job.visits++;
  const u = withPage(job.base, job.nextPg);
  const budget = await rlWait('www.99acres.com', 'this search');
  if (!budget) { job.blocked = true; job.done = true; return 'blocked'; }
  log(`  99acres page ${job.nextPg} — ${new URL(job.base).pathname}  (budget ${budget.usedDay}/${budget.cfg.perDay} today)`);
  let tab;
  try { tab = await chrome.tabs.create({ url: u, active: true }); } catch (e) { log('open failed: ' + e.message, 'err'); job.done = true; return 'error'; }
  currentTab = tab.id;
  await waitComplete(tab.id, 45000);
  await zz(3000 + Math.random() * 1500);              // let SSR data + prefetch land
  let landed = null;
  try {
    const info = await chrome.tabs.get(tab.id);
    landed = { url: info.url || '', title: info.title || '' };
    const sameHost = (() => { try { return new URL(landed.url).hostname === new URL(u).hostname; } catch (_) { return false; } })();
    if (!sameHost) log(`  ⚠ tab left the portal → ${landed.url.slice(0, 90)}`, 'err');
    else if (/captcha|verify|blocked|denied|robot|unusual/i.test(landed.title)) log(`  ⚠ challenge page: "${landed.title.slice(0, 70)}"`, 'err');
  } catch (_) {}
  let scrolled = null;
  try { scrolled = await Promise.race([chrome.tabs.sendMessage(tab.id, { cmd: 'nbtb-scroll' }), zz(60000).then(() => 'timeout')]); }
  catch (e) { scrolled = 'unreachable'; }
  if (scrolled === 'unreachable') log(`  ⚠ our capture script did not run on this page${landed ? ` (title: "${landed.title.slice(0, 50)}")` : ''} — not a normal 99acres search page`, 'err');
  await zz(1200);
  try { await chrome.tabs.remove(tab.id); } catch (_) {}
  currentTab = null;

  const buf = await new Promise(r => chrome.storage.local.get({ captures: [] }, s => r(s.captures)));
  const ours = job.mine(buf);
  const before = job.seen.size;
  job.pagesOf(buf).forEach(p => job.seen.add(p));
  const added = job.seen.size - before;
  const rows = ours.reduce((s, c) => s + (c.rows || 0), 0);
  try {
    const key = 'total:' + new URL(u).hostname + new URL(u).pathname + new URL(u).search;
    const t = await new Promise(r => chrome.storage.local.get({ [key]: null }, s => r(s[key])));
    if (t && t.total != null) { job.reported = t.total; chrome.storage.local.remove(key); }
  } catch (_) {}

  const expect = job.reported != null ? Math.ceil(job.reported / 25) : null;
  if (added === 0) {
    if (expect != null && job.seen.size >= expect) { log(`  all ${expect} pages captured`, 'ok'); job.done = true; return 'done'; }
    if (!job.retried) { job.retried = true; log('  no data on that page — pausing 30s and retrying once', 'err'); await zz(30000); return 'continue'; }
    job.blocked = true; job.done = true;
    const why = scrolled === 'unreachable' ? 'the page never ran our capture script (redirect/challenge page)' : 'the page loaded but served no listings';
    log(job.seen.size
      ? `  stopped at page ${job.nextPg}: ${job.seen.size} of ${expect || '?'} pages captured — ${why}. Re-run later; it resumes from here.`
      : `  page 1 produced nothing — ${why}. Open this URL by hand to see what 99acres serves you.`, 'err');
    return 'blocked';
  }
  job.retried = false;
  log(`  +${added} page(s) → ${job.seen.size} of ${expect || '?'} pages · ~${rows} listings`, 'ok');
  if (expect != null && job.seen.size >= expect) { log('  all reported listings captured', 'ok'); job.done = true; return 'done'; }
  job.nextPg = Math.max(...[...job.seen].map(Number)) + 1;
  return 'continue';
}

// Persist resume progress + log the locality summary once a walk ends.
async function a99Finish(job) {
  const buf2 = await new Promise(r => chrome.storage.local.get({ captures: [] }, s => r(s.captures)));
  const rows2 = job.mine(buf2).reduce((s, c) => s + (c.rows || 0), 0);
  const pct = job.reported ? Math.round(rows2 / job.reported * 100) : null;
  try {
    await chrome.storage.local.set({ [job.progKey]: {
      maxPage: job.seen.size ? Math.max(...[...job.seen].map(Number)) : 0,
      pages: [...job.seen], total: job.reported, blocked: job.blocked, at: Date.now()
    } });
  } catch (_) {}
  log(`99acres ${job.blocked ? 'INCOMPLETE' : 'done'} (${new URL(job.base).pathname}): ${job.seen.size} page(s), ~${rows2} listings${job.reported != null ? ` / ${job.reported} available (${pct}%)` : ''}`, (!job.blocked && (pct == null || pct >= 80)) ? 'ok' : 'err');
}

// Do one full-scroll search on a non-paginated portal (used both as an
// interleave spacer and, for leftover searches, on its own).
async function scrollSearch(url, label) {
  const host = (() => { try { return new URL(url).hostname; } catch (_) { return ''; } })();
  const budget = await rlWait(host, 'this search');
  if (!budget) return;
  log(`${label} opening ${url}  (budget ${budget.usedDay}/${budget.cfg.perDay} today)`);
  const beforeIds = new Set((await new Promise(r => chrome.storage.local.get({ captures: [] }, s => r(s.captures)))).map(c => c.id));
  let tab;
  try { tab = await chrome.tabs.create({ url, active: true }); } catch (e) { log('open failed: ' + e.message, 'err'); return; }
  currentTab = tab.id;
  const loaded = await waitComplete(tab.id, 45000);
  if (!loaded) log('  page load timed out - capturing whatever arrived', 'err');
  await zz(2500 + Math.random() * 1500);
  let scrolled = null;
  try {
    scrolled = await Promise.race([chrome.tabs.sendMessage(tab.id, { cmd: 'nbtb-scroll' }), zz(420000).then(() => 'cap')]);
    if (scrolled === 'cap') { try { await chrome.tabs.sendMessage(tab.id, { cmd: 'nbtb-stopscroll' }); } catch (_) {} await zz(2500); log('  scroll cap (7 min) reached - very deep page; tighten the filters.', 'err'); }
    else if (scrolled) log(`  scrolled ${scrolled.rounds} rounds (height ${scrolled.height})`);
  } catch (e) { scrolled = 'unreachable'; log('  ⚠ our capture script did not run — redirect, challenge or block page?', 'err'); }
  await zz(1500);
  try { await chrome.tabs.remove(tab.id); } catch (_) {}
  currentTab = null;
  try {
    const key = 'total:' + new URL(url).hostname + new URL(url).pathname + new URL(url).search;
    const tot = await new Promise(r => chrome.storage.local.get({ [key]: null }, s => r(s[key])));
    const buf = await new Promise(r => chrome.storage.local.get({ captures: [] }, s => r(s.captures)));
    const fresh = buf.filter(c => !beforeIds.has(c.id));
    const got = fresh.reduce((s, c) => s + (c.rows || 0), 0);
    if (tot && tot.total != null) { const pct = tot.total ? Math.round(got / tot.total * 100) : 100; log(`  coverage: ~${got} / ${tot.total} available (${pct}%)${pct < 80 ? ' ⚠ likely truncated' : ' ✓'}`, pct < 80 ? 'err' : 'ok'); chrome.storage.local.remove(key); }
    else log(`  ~${got} listings captured (portal did not report a total)`);
  } catch (_) {}
  log(`  buffer: ${await pending()} capture(s)`, 'ok');
}

// ---------------------------------------------------------------------------
// SELF-IMPOSED RATE LIMIT
//
// A 53-page walk over 26 minutes - roughly one page every 30 seconds, already
// unhurried - earned a site-wide IP block from 99acres. So the trigger was
// VOLUME, not speed: sleeping longer between pages would not have helped. The
// only thing that does is asking for less, and never being able to reset it by
// restarting the runner. Budgets live in storage and span runs, tabs, days.
//
// These numbers are deliberate under-estimates, not measured thresholds. We do
// not know 99acres' real limit; we know 53/session was over it. Staying far
// below a line you cannot see is the whole point.
// ---------------------------------------------------------------------------
const RL = {
  'www.99acres.com':     { minGapMs: 10000, perHour: 30,  perDay: 45,  note: 'IP-blocked this project once; treat as fragile' },
  'www.nobroker.in':     { minGapMs: 5000,  perHour: 90,  perDay: 300 },
  'www.magicbricks.com': { minGapMs: 5000,  perHour: 90,  perDay: 300 },
  'housing.com':         { minGapMs: 5000,  perHour: 90,  perDay: 300 },
  'www.squareyards.com': { minGapMs: 5000,  perHour: 90,  perDay: 300 },
  _default:              { minGapMs: 6000,  perHour: 60,  perDay: 200 }
};
const HOUR = 3600e3, DAY = 24 * HOUR;
const rlCfg = h => RL[h] || RL._default;
const rlGet = k => new Promise(r => chrome.storage.local.get({ [k]: [] }, s => r(s[k] || [])));

// Ask the budget for permission to load one page. Returns {ok} or a reason to
// wait / stop. Every grant is recorded before the request goes out, so a crash
// or a closed tab can never hand back budget we already spent.
async function rlTake(host) {
  const cfg = rlCfg(host), key = 'rl:' + host, now = Date.now();
  let hits = (await rlGet(key)).filter(t => now - t < DAY);
  const last = hits.length ? Math.max(...hits) : 0;
  const gap = now - last;
  if (last && gap < cfg.minGapMs) return { ok: false, waitMs: cfg.minGapMs - gap };
  const inHour = hits.filter(t => now - t < HOUR);
  if (inHour.length >= cfg.perHour) return { ok: false, stop: 'hour', resumeAt: Math.min(...inHour) + HOUR, used: inHour.length, cap: cfg.perHour };
  if (hits.length >= cfg.perDay) return { ok: false, stop: 'day', resumeAt: Math.min(...hits) + DAY, used: hits.length, cap: cfg.perDay };
  hits.push(now);
  await new Promise(r => chrome.storage.local.set({ [key]: hits }, r));
  return { ok: true, usedHour: inHour.length + 1, usedDay: hits.length, cfg };
}
const fmtWhen = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Wait for budget, or report that we're done for the hour/day. Returns false to
// stop this portal entirely.
async function rlWait(host, label) {
  for (;;) {
    if (aborted) return false;
    const t = await rlTake(host);
    if (t.ok) return t;
    if (t.waitMs) { await zz(t.waitMs); continue; }
    log(`  budget reached for ${host}: ${t.used}/${t.cap} page loads this ${t.stop}. Stopping ${label} — resumes after ${fmtWhen(t.resumeAt)}. Progress is saved.`, 'err');
    return false;
  }
}

// Ask the portal directly whether it will serve us, and read the real status
// code. A blocked client gets an empty-bodied refusal that Chrome renders as its
// own error page - content scripts never run there, so from inside a tab a block
// is indistinguishable from an empty page. This is the only way to know.
async function preflight(u) {
  try {
    const res = await fetch(u, { method: 'GET', redirect: 'follow', cache: 'no-store' });
    return { status: res.status, ok: res.ok };
  } catch (e) { return { status: 0, ok: false, err: String(e.message || e) }; }
}
const BLOCK_CODES = [401, 403, 417, 418, 429, 503];

(async () => {
  const { runUrls = [] } = await chrome.storage.local.get({ runUrls: [] });
  const all = runUrls.flatMap(expand).filter(allowed);
  if (!all.length) { log('No valid portal URLs saved. Add them in the extension popup first.', 'err'); return; }

  const a99urls = all.filter(is99);
  const spacers = all.filter(u => !is99(u));
  log(`run started · ${a99urls.length} 99acres walk(s) spaced by ${spacers.length} other search(es) · buffer has ${await pending()} capture(s)`);

  // budget snapshot — never start blind
  const now0 = Date.now();
  for (const h of [...new Set(all.map(x => { try { return new URL(x).hostname; } catch (_) { return null; } }).filter(Boolean))]) {
    const used = (await rlGet('rl:' + h)).filter(t => now0 - t < DAY).length;
    const c = rlCfg(h);
    log(`  budget · ${h}: ${used}/${c.perDay} used today${c.note ? ' — ' + c.note : ''}`, used >= c.perDay ? 'err' : undefined);
  }

  // If 99acres is refusing us at the edge, don't spine on it — just run the
  // other portals normally so the run still produces data.
  let a99jobs = [];
  if (a99urls.length && !aborted) {
    const pf = await preflight(withPage(a99urls[0], 1));
    if (BLOCK_CODES.includes(pf.status)) {
      log(`99acres returned HTTP ${pf.status} before we started — the browser is being refused site-wide, not throttled on one search. Skipping all ${a99urls.length} 99acres walk(s); running the other portals normally.`, 'err');
    } else {
      for (const u of a99urls) a99jobs.push(await a99Init(u));
    }
  }

  let spacerIdx = 0, firstPage = true, blockedRuns = 0;

  // THE SPINE: one 99acres page, then a full other-portal search as the spacer,
  // then a random floor delay — repeat. The spacer's real (variable) duration is
  // the irregular gap; the random floor guarantees a minimum even once spacers
  // run out. The per-portal budget still governs how many pages happen at all.
  for (const job of a99jobs) {
    if (aborted || blockedRuns >= 2) break;
    while (!job.done && job.visits < A99_MAX_PAGES && !aborted) {
      if (!firstPage) {
        if (spacerIdx < spacers.length) { await scrollSearch(spacers[spacerIdx], `[spacer ${spacerIdx + 1}/${spacers.length}]`); spacerIdx++; }
        const d = a99Rand();
        log(`  …pausing ${Math.round(d / 1000)}s before the next 99acres page`);
        await zz(d);
      }
      firstPage = false;
      const r = await a99Step(job);
      if (r === 'blocked') {
        blockedRuns++;
        if (blockedRuns >= 2) { log('99acres refused results twice — stopping 99acres for now. Progress is saved; it resumes next run.', 'err'); break; }
      }
    }
    await a99Finish(job);
  }

  // Any other-portal searches not consumed as spacers still run — we want their
  // data regardless of how many 99acres pages there were.
  while (spacerIdx < spacers.length && !aborted) {
    await scrollSearch(spacers[spacerIdx], `[${spacerIdx + 1}/${spacers.length}]`);
    spacerIdx++;
  }

  log(aborted ? 'run stopped.' : `run finished · ${await pending()} capture(s) pending`, 'ok');
  log('open the tracker page - it drains the buffer automatically.');
})();
