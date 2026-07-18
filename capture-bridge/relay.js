// Isolated-world side on portal pages: receives teed payloads from the
// interceptor, dedupes, and stores them for the tracker bridge to collect.
(() => {
  const h = s => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0; return x.toString(36); };
  // ---- "save this search?" banner: offered when this page actually yields
  // listing data (the one reliable, portal-agnostic definition of a search) ----
  const prompted = new Set();
  function isSearchPage() {
    const host = location.hostname, p = location.pathname, s = location.search;
    if (host.indexOf('nobroker') !== -1)    return /\/property\/(rent|sale|buy)\//.test(p);
    if (host.indexOf('99acres') !== -1)     return /(search|srp|rent|sale|property-in)/i.test(p + s);
    if (host.indexOf('magicbricks') !== -1) return /(property-for-rent|property-for-sale|-for-rent|-for-sale|srp)/i.test(p);
    if (host.indexOf('housing') !== -1)     return /\/(rent|buy|resale)\//.test(p) && !/\/(project|property)\//.test(p);
    if (host.indexOf('squareyards') !== -1) return /^\/(rent|sale)\//.test(p);
    return false;
  }
  function maybeOfferSave() {
    if (!isSearchPage()) return;
    const u = location.href;
    if (prompted.has(u)) return;
    prompted.add(u);
    chrome.storage.local.get({ runUrls: [], ignoredSearches: [] }, st => {
      if (st.runUrls.includes(u) || st.ignoredSearches.includes(u)) return;
      if (document.getElementById('nbtb-savebar')) return;
      const d = document.createElement('div');
      d.id = 'nbtb-savebar';
      d.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#fff;border:1px solid #2B6FD4;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:12px 14px;font:13px/1.4 system-ui,sans-serif;color:#1c2733;max-width:300px';
      d.innerHTML = '<div style="font-weight:700;color:#2B6FD4;margin-bottom:6px">Rental Tracker</div>'
        + '<div style="margin-bottom:10px">Save this search for one-click capture runs?</div>'
        + '<button id="nbtb-sv" style="padding:6px 14px;border-radius:8px;border:none;background:#2B6FD4;color:#fff;font-weight:700;cursor:pointer">Save</button> '
        + '<button id="nbtb-no" style="padding:6px 12px;border-radius:8px;border:1px solid #d7dee7;background:#fff;cursor:pointer;color:#1c2733">Not this one</button>';
      (document.body || document.documentElement).appendChild(d);
      const gone = () => { try { d.remove(); } catch (_) {} };
      d.querySelector('#nbtb-sv').onclick = () => {
        chrome.storage.local.get({ runUrls: [] }, s2 => {
          if (!s2.runUrls.includes(u)) s2.runUrls.push(u);
          chrome.storage.local.set({ runUrls: s2.runUrls }, () => {
            d.innerHTML = '<div style="color:#137a3a;font-weight:700">Saved &#10003; &mdash; it is in your Run list.</div>';
            setTimeout(gone, 2200);
          });
        });
      };
      d.querySelector('#nbtb-no').onclick = () => {
        chrome.storage.local.get({ ignoredSearches: [] }, s2 => {
          s2.ignoredSearches.push(u);
          while (s2.ignoredSearches.length > 200) s2.ignoredSearches.shift();
          chrome.storage.local.set({ ignoredSearches: s2.ignoredSearches });
        });
        gone();
      };
      setTimeout(gone, 20000); // never nags - auto-dismisses
    });
  }

  // fire on first load and on every SPA navigation, independent of data capture
  const H = history.pushState; history.pushState = function (...a) { const rr = H.apply(this, a); setTimeout(maybeOfferSave, 1200); return rr; };
  window.addEventListener('popstate', () => setTimeout(maybeOfferSave, 1200));
  if (document.readyState === 'complete') setTimeout(maybeOfferSave, 1500);
  else window.addEventListener('load', () => setTimeout(maybeOfferSave, 1500));

  // remember the portal-reported total for the current page (runner reads it)
  window.addEventListener('message', ev => {
    const m = ev && ev.data;
    if (!m || m.__nbtbTotal !== 1) return;
    chrome.storage.local.set({ ['total:' + m.host + m.path]: { total: m.total, at: Date.now() } });
  });

  window.addEventListener('message', ev => {
    const m = ev && ev.data;
    if (!m || m.__nbtb !== 1 || typeof m.text !== 'string') return;
    maybeOfferSave();
    // 99acres serves each page twice (server-rendered on the page you land on,
    // prefetched over XHR from neighbouring pages). Key those by locality+page
    // so one page counts once, no matter how many times it arrives.
    let id;
    try {
      const uo = new URL(m.url);
      if (uo.hostname.indexOf('99acres') !== -1 && uo.searchParams.get('page')) {
        id = 'a99:' + (uo.searchParams.get('__loc') || '') + ':' + uo.searchParams.get('page');
      }
    } catch (_) {}
    if (!id) id = h(m.url) + '_' + h(m.text) + '_' + m.text.length;
    // How many listings does this payload hold? Route by HOSTNAME - never by
    // sniffing the body text, which misclassifies payloads across portals.
    let rowCount = 0;
    try {
      const host = (function () { try { return new URL(m.url).hostname; } catch (_) { return ''; } })();
      if (host.indexOf('magicbricks') !== -1) {
        if (m.text.indexOf('SERVER_PRELOADED_STATE_') !== -1) {
          const i = m.text.indexOf('"searchResult"');
          const seg = i !== -1 ? m.text.slice(i, i + 2000000) : '';
          rowCount = (seg.match(/"psmid"\s*:/g) || []).length || (seg.match(/"propertyTitle"\s*:/g) || []).length;
        } else { const j = JSON.parse(m.text); if (Array.isArray(j.resultList)) rowCount = j.resultList.length; }
      } else if (host.indexOf('squareyards') !== -1) {
        rowCount = (m.text.match(/propertyId="\d+"/g) || []).length;
      } else if (host.indexOf('99acres') !== -1) {
        const j = JSON.parse(m.text); if (Array.isArray(j.properties)) rowCount = j.properties.length;
      } else if (host.indexOf('housing') !== -1) {
        const j = JSON.parse(m.text); try { rowCount = j.data.searchResults.properties.length; } catch (_) { rowCount = 0; }
      } else {
        const j = JSON.parse(m.text); const d = j && j.data;
        if (Array.isArray(d)) rowCount = d.length;
        else if (d && typeof d === 'object') { for (const k of ['data', 'properties', 'propertyList', 'results']) if (Array.isArray(d[k])) { rowCount = d[k].length; break; } }
      }
    } catch (_) { rowCount = 0; }
    chrome.storage.local.get({ captures: [] }, st => {
      const c = st.captures;
      if (c.some(x => x.id === id)) return;
      c.push({ id, url: m.url, text: m.text, rows: rowCount, at: Date.now() });
      while (c.length > 400) c.shift(); // cap the buffer; oldest pages drop first
      // A failed write here used to vanish silently - captures would simply stop
      // being stored while every log still said "captured". Never again.
      chrome.storage.local.set({ captures: c }, () => {
        const e = chrome.runtime.lastError;
        if (e) console.error('[capture-bridge] STORAGE WRITE FAILED — captures are being lost:', e.message);
      });
    });
  });
})();

// ---- auto-scroll driver (commanded by the runner page) ----
(() => {
  let stopFlag = false;
  const zz = ms => new Promise(r => setTimeout(r, ms));
  const pageH = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  const atBottom = () => (window.scrollY + window.innerHeight) >= pageH() - 80;
  // Housing's infinite loader occasionally stalls: the bottom sentinel fails to
  // fire, so the next SEARCH_RESULTS page never requests and those ~30 listings
  // never even reach the network. A short up-then-down jiggle re-arms the sentinel.
  // Scoped to housing.com so the tuned timing on other portals is untouched.
  const isHousing = location.hostname.indexOf('housing.com') !== -1;
  async function jiggle() {
    const h = pageH();
    // up two viewport-steps, then back down to the bottom - two down-scrolls
    window.scrollBy(0, -Math.round(window.innerHeight * 1.2)); await zz(500 + Math.random() * 400);
    window.scrollBy(0, -Math.round(window.innerHeight * 1.2)); await zz(500 + Math.random() * 400);
    window.scrollTo(0, h * 0.6);                               await zz(400 + Math.random() * 300);
    window.scrollTo(0, pageH());                               await zz(1400 + Math.random() * 900);
  }
  async function autoScroll() {
    stopFlag = false;
    let last = pageH(), strikes = 0, rounds = 0;
    // round guard chosen so even a pathological page at max dwell (~4s) stays
    // under the runner's 7-minute scroll cap; real pages need far fewer rounds
    for (rounds = 0; rounds < 90 && strikes < 4 && !stopFlag; rounds++) {
      // go to the current bottom - that is what arms the infinite-scroll loader
      window.scrollTo(0, pageH());
      // randomized dwell: enough variance to break the fixed rhythm, but capped
      // so a deep page still finishes inside the 7-minute scroll budget. A wide
      // gap (e.g. up to 10s) would both blow the cap and make a slow loader look
      // like "no growth", ending the scroll early and under-capturing.
      await zz(1500 + Math.random() * 2500);           // 1.5-4s dwell for the loader's XHR
      let h = pageH();
      if (h > last) { strikes = 0; last = h; continue; }
      if (!atBottom()) { strikes = 0; continue; }      // not actually at the bottom yet - keep going
      // at the bottom with no growth: give a slow loader one more beat before counting a strike
      await zz(1600);
      h = pageH();
      if (h > last) { strikes = 0; last = h; continue; }
      // Housing may have stalled rather than finished: jiggle up-and-down to re-arm
      // the loader, but only on the first two strikes so a genuinely exhausted page
      // still terminates (strike 3 -> 4 ends the loop as before).
      if (isHousing && strikes < 2) {
        await jiggle();
        h = pageH();
        if (h > last) { strikes = 0; last = h; continue; }
      }
      strikes++;
    }
    window.scrollTo(0, 0);
    await zz(800); // let the last teed batch land in the relay
    return { rounds, height: last, stopped: stopFlag };
  }

  // Square Yards paginates via AJAX: clicking li.applyPagination[data-page=N] swaps
  // content in place (URL never changes). We read the page numbers from the DOM,
  // click through them in order, and let each click fire the site's own request -
  // the interceptor captures the getListingV3FilterTile response. We never forge the
  // request; we drive the same control a person would, paced and bounded.
  async function syWalk(opts){
    opts = opts || {};
    const maxPages = opts.maxPages || 30;         // hard safety rail
    const minGap = opts.minGap || 4000, jitter = opts.jitter || 4000;
    const pagerLis = () => Array.from(document.querySelectorAll('li.applyPagination[data-page]'));
    const pageNums = () => Array.from(new Set(pagerLis().map(li => parseInt(li.getAttribute('data-page'),10)).filter(n=>!isNaN(n)))).sort((a,b)=>a-b);
    // discover the last page from the pager (e.g. the "...15" tail)
    let nums = pageNums();
    if (!nums.length) return { pages: 0, last: 1, note: 'no pager found (single page)' };
    const last = Math.min(Math.max(...nums), maxPages);
    let walked = 1;                                // page 1 is already loaded on arrival
    // ALWAYS advance via the right-arrow, never by clicking a specific page number:
    // the pager collapses middle pages behind "..." (e.g. 1 ... 3 4 5 ... 15), so
    // data-page="2" often does not exist. The right-arrow always means "next page"
    // regardless of collapse, so it is the only reliable way to walk sequentially.
    for (let p = 2; p <= last && !stopFlag; p++){
      // the right-arrow is the last applyPagination li carrying the arrow icon
      const arrowLi = Array.from(document.querySelectorAll('li.applyPagination')).find(li => li.querySelector('[class*="icon-arrow-right"]'));
      if (!arrowLi) break;                         // no next-arrow -> we are on the last page
      // if the arrow is disabled/absent target, stop
      const target = arrowLi.getAttribute('data-page');
      arrowLi.click();
      await zz(minGap + Math.random()*jitter);     // paced, non-uniform gap between pages
      let tries = 0;
      while (tries < 8 && document.querySelector('.npLoader, .loading, [class*="loader"]')) { await zz(1000); tries++; }
      walked++;
      // safety: if clicking did not advance (arrow target unchanged), stop to avoid a loop
      const activeNow = document.querySelector('li.applyPagination.active[data-page]');
      if (activeNow && parseInt(activeNow.getAttribute('data-page'),10) >= last) break;
    }
    window.scrollTo(0,0);
    await zz(800);                                 // let the last teed batch land
    return { pages: walked, last, stopped: stopFlag };
  }
  chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
    if (m && m.cmd === 'nbtb-scroll') { autoScroll().then(sendResponse); return true; }
    if (m && m.cmd === 'nbtb-sypage') { syWalk(m.opts).then(sendResponse); return true; }
    if (m && m.cmd === 'nbtb-stopscroll') { stopFlag = true; }
  });
})();
