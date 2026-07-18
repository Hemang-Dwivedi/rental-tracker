// Runs in the portal page's MAIN world. Tees listing API responses to the
// relay via window.postMessage - the same cooperative-bridge pattern the
// portals could have shipped themselves, supplied by you instead.
(() => {
  if (window.__nbtbHooked) return; window.__nbtbHooked = true;
  // URL fragments mirror the tracker's HAR router exactly
  const WANT = ['/multi/property/RENT/filter', '/api-aggregator/srp/search', '/mbsrp/propertySearch', 'apiName=SEARCH_RESULTS', 'getListingV3FilterTile'];
  const hit = u => { u = String(u || ''); return WANT.some(w => u.indexOf(w) !== -1); };
  // Square Yards returns {html, totalCount} from getListingV3FilterTile. Unwrap the
  // html blob and tag the URL so the tracker's SY parser handles it; the totalCount
  // rides along in a marker the coverage reader can find.
  const syUnwrap = (url, text) => {
    if (String(url).indexOf('getListingV3FilterTile') === -1) return [text, url];
    try { const j = JSON.parse(text); const html = j.html || ''; const tc = j.totalCount != null ? j.totalCount : ''; 
      return ['<!--SYTOTAL:' + tc + '-->' + html, 'https://www.squareyards.com/__sylisting?total=' + tc]; }
    catch (_) { return [text, url]; }
  };
  const tag99 = (u) => { try {
    if (location.hostname.indexOf('99acres') === -1) return u;
    const loc = new URLSearchParams(location.search).get('locality') || location.pathname;
    return u + (u.indexOf('?') !== -1 ? '&' : '?') + '__loc=' + encodeURIComponent(loc);
  } catch (_) { return u; } };
  const send = (url, text) => { try { if (text && text.length > 50) window.postMessage({ __nbtb: 1, url: tag99(String(url)), text: String(text) }, '*'); } catch (_) {} };
  // Parse the portal's own "N available" total out of a captured response and
  // announce it, so the runner can show captured-vs-available coverage live.
  const announceTotal = (url, text) => {
    try {
      let n = null;
      if (/nobroker\.in/.test(location.hostname)) {
        const m = String(text).match(/"message"\s*:\s*"(\d[\d,]*)\s+Rental/i);
        if (m) n = parseInt(m[1].replace(/,/g, ''), 10);
      } else if (/99acres\.com/.test(location.hostname)) {
        const j = JSON.parse(text); if (typeof j.count === 'number') n = j.count;
      } else if (/magicbricks\.com/.test(location.hostname)) {
        const m = String(text).match(/"resultCount"\s*:\s*"?(\d+)/); if (m) n = parseInt(m[1], 10);
      } else if (/squareyards\.com/.test(location.hostname)) {
        const m = String(text).match(/"totalCount"\s*:\s*(\d+)/); if (m) n = parseInt(m[1], 10);
      }
      if (n != null && n >= 0) window.postMessage({ __nbtbTotal: 1, host: location.hostname, path: location.pathname + location.search, total: n }, '*');
    } catch (_) {}
  };

  // fetch tee
  const F = window.fetch;
  if (F) window.fetch = function (...a) {
    const p = F.apply(this, a);
    try {
      const u = (a[0] && a[0].url) || a[0];
      if (hit(u)) p.then(r => { try { if (r.status === 304 || !r.ok) return; r.clone().text().then(t => { if (t && t.length > 200) { const [txt, purl] = syUnwrap(r.url || u, t); send(purl, txt); announceTotal(purl, txt); } }).catch(() => {}); } catch (_) {} }).catch(() => {}); // observation chain must never surface as an unhandled rejection
    } catch (_) {}
    return p;
  };
  // XHR tee
  const O = XMLHttpRequest.prototype.open, S = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { try { this.__nbtbU = u; } catch (_) {} return O.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function (...a) {
    try { if (hit(this.__nbtbU)) { this.addEventListener('error', () => {}); this.addEventListener('abort', () => {}); } } catch (_) {}
    try { if (hit(this.__nbtbU)) this.addEventListener('loadend', () => { try { if ((this.responseType === '' || this.responseType === 'text') && this.status !== 304 && this.status >= 200 && this.status < 300) { const rt = this.responseText; if (rt && rt.length > 200) { const [txt, purl] = syUnwrap(this.responseURL || this.__nbtbU, rt); send(purl, txt); announceTotal(purl, txt); } } } catch (_) {} }); } catch (_) {}
    return S.apply(this, a);
  };

  // Magicbricks ships results in the page's preloaded state, not XHR.
  // Send under a canonical URL the tracker's router always recognizes.
  const mb = () => { try {
    if (location.hostname.indexOf('magicbricks') === -1) return;
    const st = window.SERVER_PRELOADED_STATE_;
    if (st && Array.isArray(st.searchResult) && st.searchResult.length) {
      const payload = 'var SERVER_PRELOADED_STATE_ = ' + JSON.stringify(st) + ';';
      if (payload !== window.__nbtbMbLast) { window.__nbtbMbLast = payload; send('https://www.magicbricks.com/property-for-rent/captured', payload); announceTotal(location.href, JSON.stringify(st.searchAdditionalDataBean||{})); }
    }
  } catch (_) {} };

  // Square Yards renders listings as HTML attributes in the DOM.
  const sy = () => { try {
    if (location.hostname.indexOf('squareyards') === -1) return;
    if (!/^\/(rent|sale)\//.test(location.pathname)) return;
    const els = document.querySelectorAll('small.map-cta,[propertyId]');
    if (!els.length) return;
    let html = ''; els.forEach(e => { html += e.outerHTML; });
    if (html !== window.__nbtbSyLast) { window.__nbtbSyLast = html; send('https://www.squareyards.com' + location.pathname, html); }
  } catch (_) {} };

  // 99acres server-renders the page you land on into window.__initialData__ and
  // only PREFETCHES other pages over XHR. Without this, every landed page is
  // invisible to us. Emit it under a canonical srp/search URL so the tracker's
  // existing 99acres parser and the relay's dedup treat it like any other page.
  const acres = () => { try {
    if (location.hostname.indexOf('99acres') === -1) return;
    const d = window.__initialData__; if (!d) return;
    const findProps = (o, depth) => {
      if (!o || depth > 5) return null;
      if (Array.isArray(o)) return (o.length && o[0] && (o[0].PROP_ID !== undefined || o[0].SPID !== undefined)) ? o : null;
      if (typeof o === 'object') { for (const k in o) { const r = findProps(o[k], depth + 1); if (r) return r; } }
      return null;
    };
    const arr = findProps(d, 0); if (!arr || !arr.length) return;
    const findCount = (o, depth) => {
      if (!o || depth > 4 || typeof o !== 'object') return null;
      if (typeof o.count === 'number') return o.count;
      for (const k in o) { const r = findCount(o[k], depth + 1); if (r != null) return r; }
      return null;
    };
    const qs = new URLSearchParams(location.search);
    const pg = qs.get('page') || '1';
    const loc = qs.get('locality') || qs.get('locality_array') || location.pathname;
    const payload = JSON.stringify({ properties: arr, count: findCount(d, 0) });
    if (payload === window.__nbtbAcLast) return;
    window.__nbtbAcLast = payload;
    send('https://www.99acres.com/api-aggregator/srp/search?locality_array=' + encodeURIComponent(loc) + '&page=' + pg + '&page_size=25&pageName=SRP&ssr=1', payload);
    announceTotal(location.href, payload);
  } catch (_) {} };

  const scan = () => { mb(); sy(); acres(); };
  window.addEventListener('load', () => setTimeout(scan, 1200));
  let t = null; const later = () => { clearTimeout(t); t = setTimeout(scan, 1500); };
  window.addEventListener('scroll', later, { passive: true });
  const H = history.pushState; history.pushState = function (...a) { const r = H.apply(this, a); later(); return r; };
  window.addEventListener('popstate', later);
})();
