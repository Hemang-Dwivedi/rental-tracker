const fs = require('fs');
require('fake-indexeddb/auto');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const ok = (cond, name, extra='') => {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name, extra); }
};

// read persisted rows straight from the shared fake IndexedDB
function idbAll() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('nb_rentals', 1);
    rq.onsuccess = e => {
      const db = e.target.result;
      const r = db.transaction('listings', 'readonly').objectStore('listings').getAll();
      r.onsuccess = () => { db.close(); res(r.result || []); };
      r.onerror = () => { db.close(); rej(r.error); };
    };
    rq.onerror = e => rej(e.target.error);
  });
}

function makeDom() {
  const vc = new VirtualConsole(); // swallow jsdom "not implemented" noise
  vc.on('jsdomError', () => {});
  const state = { blobs: [], fetch: async () => ({ status: 200, json: async () => ({}) }) };
  const dom = new JSDOM(html, {
    url: 'https://localhost/index.html',
    runScripts: 'dangerously',
    virtualConsole: vc,
    beforeParse(w) {
      w.indexedDB = global.indexedDB;
      w.IDBKeyRange = global.IDBKeyRange;
      w.fetch = (...a) => state.fetch(...a);
      w.confirm = () => true;
      w.prompt = () => state.promptValue;
      w.Blob = class { constructor(parts, opts) { this.content = parts.join(''); this.type = opts && opts.type; } };
      w.URL.createObjectURL = b => { state.blobs.push(b); return 'blob:test'; };
      w.HTMLAnchorElement.prototype.click = function(){};
    }
  });
  return { dom, state };
}

(async () => {
  const { dom, state } = makeDom();
  const doc = dom.window.document;
  const $ = id => doc.getElementById(id);
  const msg = () => $('msg').textContent;
  await sleep(400); // let async init settle

  console.log('T0: paste path (NoBroker page source, tagged at extraction)');
  const nbObj = JSON.stringify({ propertyTitle: 'Paste Test', id: 'PST1', typeDesc: '2 BHK', locality: 'Hadapsar', rent: 18000, latitude: '18.51', longitude: '73.93', leaseTypeNew: ['ANYONE'], detailUrl: '/p/x' });
  $('paste').value = 'x'.repeat(600) + ' {"wrapper":' + nbObj + '} tail';
  $('parse').click();
  await sleep(150);
  ok($('s-total').textContent === '1', 'paste added 1 listing', msg());
  let rows = await idbAll();
  ok(rows.length === 1 && rows[0].id === 'nb_PST1' && rows[0].source === 'NoBroker', 'persisted as nb_ / NoBroker');
  ok(!('isNew' in rows[0]), 'isNew not persisted on add');
  ok(doc.querySelectorAll('#grid .card.new').length === 1, 'in-session new outline still shows');

  console.log('T0b: clear all');
  $('clear').click();
  await sleep(150);
  rows = await idbAll();
  ok($('s-total').textContent === '0' && rows.length === 0, 'clear wiped memory + disk');

  console.log('T1: HAR import - swapped 99acres coords + sniff-key-less Magicbricks record');
  const har = { log: { entries: [
    { request: { url: 'https://www.99acres.com/api-aggregator/srp/search?a=1' },
      response: { content: { text: JSON.stringify({ properties: [{ PROP_ID: 'T99', BEDROOM_NUM: '2', PROP_HEADING: 'Swap Test', SOCIETY_NAME: 'Soc', LOCALITY: 'Hadapsar, Pune', PRICE: '25,000', CARPET_SQFT: '900', BATHROOM_NUM: '2', FURNISH: 4, MAP_DETAILS: { LATITUDE: '73.9277257', LONGITUDE: '18.5161523' }, RENTAL_ATTRIBUTES: { occ_r: 'FA,AN' }, PD_URL: '/rent/x', CLASS: 'O' }] }) } } },
    { request: { url: 'https://www.magicbricks.com/property-for-rent/residential?b=2' },
      response: { content: { text: '<html><script>var SERVER_PRELOADED_STATE_ = {"searchResult":[{"id":222,"propertyTitle":"MB Test","price":"20000","bedroomD":"2","lmtDName":"Hadapsar","tenantsPreference":"family and bachelor","furnishedD":"Semi-Furnished","url":"2-BHK-Test-Hadapsar&id=4d42303030","userType":"Agent"}]};</scr' + 'ipt></html>' } } },
    { request: { url: 'https://www.nobroker.in/api/v3/multi/property/RENT/filter?p=1' },
      response: { content: { text: JSON.stringify({ data: [{ id: 'NBX1', propertyTitle: 'NB Test', typeDesc: '2 BHK', locality: 'Magarpatta', rent: 22000, deposit: 50000, latitude: '18.5162', longitude: '73.9269', leaseTypeNew: ['BACHELOR'], detailUrl: '/prop/x' }] }) } } }
  ] } };
  await $('harFile').onchange({ target: { files: [{ text: async () => JSON.stringify(har) }], value: '' } });
  await sleep(150);
  rows = await idbAll();
  const r99 = rows.find(r => r.id === '99a_T99');
  const rmb = rows.find(r => r.id === 'mb_222');
  const rnb = rows.find(r => r.id === 'nb_NBX1');
  ok(rows.length === 3, 'HAR imported 3 records', String(rows.length));
  ok(!!rmb && rmb.source === 'Magicbricks' && rmb.type === '2 BHK' && rmb.furnish === 'Semi', 'sniff-key-less MB record routed by __src tag (old code: misrouted to NoBroker)', JSON.stringify(rmb && {s: rmb.source}));
  ok(!!r99 && r99.coordBad === true && r99.lat === null && r99.straight === null, 'swapped coords NULLED when no locality corroboration exists', JSON.stringify(r99 && { lat: r99.lat, bad: r99.coordBad }));
  ok(rmb && rmb.lat === null && rmb.straight === null && !rmb.coordBad, 'no-coords record nulled without bad flag');
  ok(rows.every(r => !('isNew' in r)), 'no isNew on disk after HAR merge');
  ok(rnb && rnb.leaseTypes.join() === 'Bachelor', 'NB lease labels intact');

  console.log('T1b: MB detail URL + postedBy');
  ok(rmb && rmb.url === 'https://www.magicbricks.com/propertyDetails/2-BHK-Test-Hadapsar&id=4d42303030', 'MB url built with /propertyDetails/ segment', rmb && rmb.url);
  ok(rmb && rmb.postedBy === 'Agent', 'MB userType -> postedBy Agent');
  ok(r99 && r99.postedBy === 'Owner', '99a CLASS O -> postedBy Owner');
  ok(rnb && rnb.postedBy === 'Owner', 'NoBroker records tagged Owner (owner-direct platform)');
  const g1 = $('grid').innerHTML;
  ok(g1.includes('pbadge own">Owner') && g1.includes('pbadge agt">Agent'), 'Owner/Agent badges render on cards');
  ok($('filterGrid').innerHTML.includes('Posted by'), 'Posted by filter block present');

  console.log('T2: restore - stale isNew stripped, photo-src escaped, js: href neutralized');
  const backup = { app: 'nobroker-tracker', version: 1, listings: [
    { id: 'x_esc', source: 'NoBroker', type: '2 BHK', rent: 21000, isNew: true, photos: ['https://img/a".onerror="x'], url: 'javascript:alert(1)', leaseTypes: [], locality: 'Hadapsar', addedAt: 111, building: 'EscTest' },
    { id: 'x_sy', source: 'Square Yards', type: '2 BHK', rent: 26000, photos: ['https://sq/p1.jpg','https://sq/p2.jpg'], url: 'https://sq/x', leaseTypes: [], locality: 'Hadapsar', addedAt: 112, title: 'SY Untagged' }
  ] };
  await $('importFile').onchange({ target: { files: [{ text: async () => JSON.stringify(backup) }], value: '' } });
  await sleep(150);
  rows = await idbAll();
  ok(rows.length === 5, 'restore merged to 5', String(rows.length));
  ok(rows.every(r => !('isNew' in r)), 'restored rows carry no isNew');
  const grid = $('grid').innerHTML;
  ok(grid.includes('src="https://img/a&quot;.onerror=&quot;x"'), 'photo src escaped', grid.slice(grid.indexOf('img/a'), grid.indexOf('img/a') + 60));
  ok(grid.includes('href="#"') && !grid.includes('javascript:alert'), 'javascript: href neutralized to #');

  console.log('T3: (untagged) lease facet');
  const leaseBox = doc.querySelector('[data-cat="leaseTypes"]');
  const chip = v => [...leaseBox.querySelectorAll('.opt')].find(o => o.dataset.v === v);
  const un = chip('(untagged)');
  ok(!!un && un.querySelector('.ct').textContent === '2', 'untagged facet present with count 2', un && un.textContent);
  un.click(); await sleep(100);
  ok($('s-shown').textContent === '2', 'untagged filter shows the 2 lease-less records', $('s-shown').textContent);
  doc.querySelector('[data-cat="leaseTypes"] .opt[data-v="Bachelor"]').click(); await sleep(100);
  ok($('s-shown').textContent === '4', 'untagged OR Bachelor widens to 4', $('s-shown').textContent);
  $('resetFilters').click(); await sleep(100);
  ok($('s-shown').textContent === '5', 'reset restores all 5');

  console.log('T3b: lightbox');
  const lb = $('lightbox');
  const syImgs = doc.querySelectorAll('article[data-id="x_sy"] .track img');
  ok(syImgs.length === 2, 'multi-photo card renders both slides', String(syImgs.length));
  syImgs[1].click();
  ok(!lb.hidden && $('lb-img').src === 'https://sq/p2.jpg' && $('lb-ct').textContent === '2 / 2', 'clicking 2nd slide opens lightbox at photo 2', $('lb-ct').textContent);
  $('lb-next').click();
  ok($('lb-img').src === 'https://sq/p1.jpg' && $('lb-ct').textContent === '1 / 2', 'next wraps to photo 1');
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  ok($('lb-img').src === 'https://sq/p2.jpg', 'arrow-key navigation works');
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  ok(lb.hidden && doc.body.style.overflow === '', 'Escape closes and restores scroll');
  doc.querySelector('article[data-id="x_esc"] .track img').click();
  ok(!lb.hidden && $('lb-prev').style.display === 'none' && $('lb-ct').textContent === '1 / 1', 'single-photo card hides nav arrows');
  $('lb-x').click();
  ok(lb.hidden, 'close button works');

  console.log('T3c: Google Maps links');
  const gmail = $('grid').innerHTML;
  ok((gmail.match(/mapbtn/g) || []).length === 15, 'search + route + remove buttons on all 5 cards', String((gmail.match(/mapbtn/g) || []).length));
  ok(gmail.includes('https://www.google.com/maps/search/?api=1&amp;query=SY%20Untagged%2C%20Hadapsar%2C%20Pune'), 'search query = name + locality + Pune, portal pin bypassed');
  ok(gmail.includes('maps/dir/?api=1&amp;origin=18.5204,73.8567&amp;destination='), 'route link originates at the configured destination (default until set)', gmail.slice(gmail.indexOf('maps/dir'), gmail.indexOf('maps/dir') + 60));

  console.log('T4: CSV columns');
  state.blobs.length = 0;
  $('export').click();
  const csv = state.blobs[0] && state.blobs[0].content;
  const head = csv.split('\n')[0];
  ok(head.startsWith('Source,') && head.includes('LeaseTypes') && head.includes('Negotiable') && head.includes('PostedBy') && head.includes('AddedAt'), 'CSV header has new columns', head);
  ok(csv.includes('Family; Bachelor'), 'array lease types joined in CSV');
  ok(csv.split('\n').some(l => l.startsWith('99acres,')), 'source populated per row');

  console.log('T5: debounced numeric filter');
  const rentBox = doc.querySelector('[data-num="rent"]');
  const nmin = rentBox.querySelector('.nmin');
  nmin.value = '999999'; nmin.oninput(); nmin.oninput();
  ok($('s-shown').textContent === '5', 'no immediate re-render on keystroke');
  await sleep(350);
  ok($('s-shown').textContent === '0', 'filter applied after debounce window', $('s-shown').textContent);
  nmin.value = ''; nmin.oninput(); await sleep(350);
  ok($('s-shown').textContent === '5', 'cleared');

  console.log('T6: OSRM accounting - full 429 counts as failed, success persists clean');
  state.fetch = async () => ({ status: 429 });
  $('road').click();
  for (let i = 0; i < 40 && $('road').disabled; i++) await sleep(200);
  ok(/1 failed/.test(msg()) && /0 fetched/.test(msg()), '429-exhausted batch reported failed', msg());
  state.fetch = async (url) => {
    if (url.includes('api.tomtom.com')) return { status: 200, json: async () => ({ routes: [{ summary: { travelTimeSeconds: 1500, lengthInMeters: 6200 } }] }) };
    const n = (url.match(/sources=([^&]*)/)[1].split(';')).length;
    return { status: 200, json: async () => ({ code: 'Ok', durations: Array.from({length:n},()=>[600]), distances: Array.from({length:n},()=>[5000]) }) };
  };
  $('road').click();
  for (let i = 0; i < 40 && $('road').disabled; i++) await sleep(200);
  ok(/1 fetched/.test(msg()), 'retry fetched it', msg());
  rows = await idbAll();
  const got = rows.filter(r => r.driveMin === 10 && r.driveKm === 5);
  ok(got.length === 1 && rows.every(r => !('isNew' in r)), 'road times persisted (10 min / 5 km) without isNew', String(got.length));

  console.log('T6b: force recalc of current view overwrites existing values');
  state.fetch = async (url) => {
    if (url.includes('api.tomtom.com')) return { status: 200, json: async () => ({ routes: [{ summary: { travelTimeSeconds: 1500, lengthInMeters: 6200 } }] }) };
    const n = (url.match(/sources=([^&]*)/)[1].split(';')).length;
    return { status: 200, json: async () => ({ code: 'Ok', durations: Array.from({length:n},()=>[1200]), distances: Array.from({length:n},()=>[8000]) }) };
  };
  $('road').click(); await sleep(100);
  ok(/already have road times/.test(msg()), 'missing-only fetch skips records that have values', msg());
  $('roadAll').click();
  for (let i = 0; i < 40 && $('roadAll').disabled; i++) await sleep(150);
  rows = await idbAll();
  let nbx = rows.find(r => r.id === 'nb_NBX1');
  ok(nbx.driveMin === 20 && nbx.driveKm === 8, 'Recalc view force-overwrote 10min/5km -> 20min/8km', JSON.stringify({m:nbx.driveMin,k:nbx.driveKm}));
  ok(/Recalculated: 1 fetched/.test(msg()), 'recalc reports its own label', msg());

  console.log('T6c: per-card recalculate button');
  state.fetch = async (url) => {
    if (url.includes('api.tomtom.com')) return { status: 200, json: async () => ({ routes: [{ summary: { travelTimeSeconds: 1500, lengthInMeters: 6200 } }] }) };
    const n = (url.match(/sources=([^&]*)/)[1].split(';')).length;
    return { status: 200, json: async () => ({ code: 'Ok', durations: Array.from({length:n},()=>[600]), distances: Array.from({length:n},()=>[5000]) }) };
  };
  const rcBtn = doc.querySelector('article[data-id="nb_NBX1"] .rc');
  ok(!!rcBtn, 'recalc button renders on coord-bearing card');
  rcBtn.click();
  for (let i = 0; i < 30; i++) { rows = await idbAll(); nbx = rows.find(r => r.id === 'nb_NBX1'); if (nbx.driveMin === 10) break; await sleep(100); }
  ok(nbx.driveMin === 10 && nbx.driveKm === 5, 'single-record recalc updated and persisted', JSON.stringify({m:nbx.driveMin}));
  ok(doc.querySelector('article[data-id="nb_NBX1"] .commute').textContent.includes('10 min'), 'card pill re-rendered with new value');
  ok(!doc.querySelector('article[data-id="x_sy"] .rc'), 'no recalc button on coordless cards');

  console.log('T6d: commute prediction - heuristic then TomTom');
  ok(doc.querySelector('article[data-id="nb_NBX1"] .commute .pk').textContent.includes('18 min @ peak'), 'heuristic peak estimate renders (10 min x 1.8)', doc.querySelector('article[data-id="nb_NBX1"] .commute .pk').textContent);
  const kIn = $('peakK'); kIn.value = '2.5'; kIn.oninput(); await sleep(400);
  ok(doc.querySelector('article[data-id="nb_NBX1"] .commute .pk').textContent.includes('25 min @ peak'), 'peak factor is user-calibratable', doc.querySelector('article[data-id="nb_NBX1"] .commute .pk').textContent);
  kIn.value = '1.8'; kIn.oninput(); await sleep(400);
  const tIn = $('ttKey'); tIn.value = 'FAKEKEY'; tIn.onchange();
  ok(/key saved/.test(msg()), 'TomTom key stored');
  $('predictView').click();
  for (let i = 0; i < 40 && $('predictView').disabled; i++) await sleep(150);
  rows = await idbAll();
  nbx = rows.find(r => r.id === 'nb_NBX1');
  ok(nbx.peakMin === 25 && nbx.peakAt === 'Mon 09:00' && !('isNew' in nbx), 'TomTom prediction persisted (25 min)', JSON.stringify({p:nbx.peakMin}));
  ok(doc.querySelector('article[data-id="nb_NBX1"] .commute .pk').textContent.includes('25 min @ Mon 9am'), 'pill shows the real prediction instead of the heuristic');
  ok(/1 predicted/.test(msg()), 'prediction run reported', msg());
  state.blobs.length = 0; $('export').click();
  ok(state.blobs[0].content.split('\n')[0].includes('PeakMin'), 'CSV gained PeakMin column');
  tIn.value = ''; tIn.onchange();

  console.log('T7: full vs lite backup');
  state.blobs.length = 0;
  $('exportJson').click(); $('exportJsonLite').click();
  const full = JSON.parse(state.blobs[0].content), lite = JSON.parse(state.blobs[1].content);
  ok(full.lite === false && full.listings.some(r => r.raw), 'full backup keeps raw');
  ok(lite.lite === true && lite.listings.every(r => !('raw' in r) && !('isNew' in r)), 'lite backup drops raw and isNew');
  ok(lite.count === 5, 'lite count intact');

  console.log('T8: reload in a fresh window - persistence + no stale new-outlines');
  const second = makeDom();
  await sleep(500);
  const d2 = second.dom.window.document;
  ok(d2.getElementById('s-total').textContent === '5', 'fresh window loads all 5 from IndexedDB', d2.getElementById('s-total').textContent);
  ok(d2.querySelectorAll('#grid .card.new').length === 0, 'no stale new outlines after reload');
  ok(d2.getElementById('filterGrid').innerHTML.includes('NoBroker only'), 'amenity honesty label renders');

  console.log('T9: no coord salvage + pin-mismatch badge');
  const w3 = makeDom();
  await sleep(500);
  const d3 = w3.dom.window.document, $3 = id => d3.getElementById(id);
  $3('clear').click(); await sleep(150);
  const seeds = Array.from({length: 8}, (_, k) => ({ id: 'SEED' + k, propertyTitle: 'Seed ' + k, typeDesc: '2 BHK', locality: 'Hadapsar', rent: 20000, latitude: String(18.514 + k * 0.001), longitude: String(73.925 + k * 0.0008), leaseTypeNew: ['BACHELOR'], detailUrl: '/s/' + k }));
  const har1 = { log: { entries: [{ request: { url: 'https://www.nobroker.in/api/v3/multi/property/RENT/filter?p=1' }, response: { content: { text: JSON.stringify({ data: seeds }) } } }] } };
  await $3('harFile').onchange({ target: { files: [{ text: async () => JSON.stringify(har1) }], value: '' } });
  await sleep(150);
  ok($3('s-total').textContent === '8', 'seeded 8 Hadapsar records', $3('s-total').textContent);
  const har2 = { log: { entries: [
    { request: { url: 'https://www.99acres.com/api-aggregator/srp/search?b=1' },
      response: { content: { text: JSON.stringify({ properties: [
        { PROP_ID: 'SWAP1', BEDROOM_NUM: '2', PROP_HEADING: 'True transpose', LOCALITY: 'Hadapsar, Pune', PRICE: '24,000', MAP_DETAILS: { LATITUDE: '73.9268', LONGITUDE: '18.5157' }, RENTAL_ATTRIBUTES: { occ_r: 'AN' }, PD_URL: '/rent/s', CLASS: 'O' },
        { PROP_ID: 'CITY1', BEDROOM_NUM: '2', PROP_HEADING: 'City junk with plausible coords', LOCALITY: 'Hadapsar, Pune', PRICE: '22,000', MAP_DETAILS: { LATITUDE: '18.5300', LONGITUDE: '73.8600', SOURCE: 'CITY', ZOOM_LEVEL: '11' }, RENTAL_ATTRIBUTES: { occ_r: 'AN' }, PD_URL: '/rent/c', CLASS: 'O' },
        { PROP_ID: 'LOC1', BEDROOM_NUM: '2', PROP_HEADING: 'Locality-level pin', LOCALITY: 'Hadapsar, Pune', PRICE: '23,000', MAP_DETAILS: { LATITUDE: '18.5165', LONGITUDE: '73.9270', SOURCE: 'LOCALITY', ZOOM_LEVEL: '12' }, RENTAL_ATTRIBUTES: { occ_r: 'AN' }, PD_URL: '/rent/l', CLASS: 'O' }
      ] }) } } },
    { request: { url: 'https://www.nobroker.in/api/v3/multi/property/RENT/filter?p=2' },
      response: { content: { text: JSON.stringify({ data: [{ id: 'FARPIN', propertyTitle: 'Far pin', typeDesc: '2 BHK', locality: 'Hadapsar', rent: 21000, latitude: '18.60', longitude: '74.05', leaseTypeNew: ['BACHELOR'], detailUrl: '/f/1' }] }) } } },
    { request: { url: 'https://www.magicbricks.com/property-for-rent/residential?t9=1' },
      response: { content: { text: '<html><script>var SERVER_PRELOADED_STATE_ = {"searchResult":[' +
        '{"id":901,"propertyTitle":"MB junk pmt","price":"21000","bedroomD":"2","lmtDName":"Hadapsar","ltcoordGeo":"18.5160,73.9265","pmtLat":"18.5900","pmtLong":"73.8900"},' +
        '{"id":902,"propertyTitle":"MB good pmt","price":"22000","bedroomD":"2","lmtDName":"Hadapsar","ltcoordGeo":"18.5160,73.9265","pmtLat":"18.5185","pmtLong":"73.9300"}' +
        ']};</scr' + 'ipt></html>' } } }
  ] } };
  await $3('harFile').onchange({ target: { files: [{ text: async () => JSON.stringify(har2) }], value: '' } });
  await sleep(150);
  rows = await idbAll();
  const sw = rows.find(r => r.id === '99a_SWAP1');
  ok(!!sw && sw.coordBad === true && sw.lat === null && sw.straight === null, 'transposed coords are NEVER salvaged - even with a matching locality nearby', JSON.stringify(sw && { lat: sw.lat, bad: sw.coordBad }));
  const city = rows.find(r => r.id === '99a_CITY1');
  ok(!!city && city.lat === null && city.coordBad === true, 'CITY-grade pin discarded even with plausible-looking coords', JSON.stringify(city && { lat: city.lat }));
  const locr = rows.find(r => r.id === '99a_LOC1');
  ok(!!locr && locr.coordApprox === true && Math.abs(locr.lat - 18.5165) < 1e-6, 'LOCALITY-grade pin kept but flagged approximate', JSON.stringify(locr && { a: locr.coordApprox }));
  const g3 = $3('grid').innerHTML;
  ok((g3.match(/pbadge sus/g) || []).length === 1, 'exactly one pin-mismatch badge (the far-pin record)', String((g3.match(/pbadge sus/g) || []).length));
  ok(g3.includes('pin &ne; locality') || g3.includes('pin ≠ locality'), 'badge text renders');
  const mj = rows.find(r => r.id === 'mb_901'), mg = rows.find(r => r.id === 'mb_902');
  ok(!!mj && Math.abs(mj.lat - 18.5160) < 1e-6 && mj.coordApprox === true, 'MB junk pmt (8 km from locality pin) falls back to locality pin, flagged', JSON.stringify(mj && { lat: mj.lat, a: mj.coordApprox }));
  ok(!!mg && Math.abs(mg.lat - 18.5185) < 1e-6 && !mg.coordApprox, 'MB sane pmt trusted as property pin, unflagged', JSON.stringify(mg && { lat: mg.lat }));
  ok((g3.match(/pbadge apx/g) || []).length === 2, 'locality-pin badges: 99acres LOCALITY record + MB fallback record', String((g3.match(/pbadge apx/g) || []).length));

  console.log('T10: recalibrate re-derives everything from raw');
  const w4 = makeDom();
  await sleep(800); // window init may auto-recalibrate the leftover records
  const d4 = w4.dom.window.document, $4 = id => d4.getElementById(id);
  $4('clear').click(); await sleep(150);
  const oldStyle = { app: 'nobroker-tracker', version: 1, listings: [
    { id: 'nb_R1', source: 'NoBroker', type: '2 BHK', rent: 20000, lat: 18.5162, lng: 73.9269, straight: 0.6, driveMin: 7, driveKm: 2.1, isNew: true, leaseTypes: ['Bachelor'], photos: [], url: 'https://nb/x', addedAt: 101, locality: 'Hadapsar',
      raw: { id: 'R1', propertyTitle: 'Keeper', typeDesc: '2 BHK', locality: 'Hadapsar', rent: 20000, latitude: '18.5162', longitude: '73.9269', leaseTypeNew: ['BACHELOR'], detailUrl: '/r/1' } },
    { id: '99a_C9', source: '99acres', type: '2 BHK', rent: 22000, lat: 18.53, lng: 73.86, straight: 6.6, driveMin: 99, driveKm: 30, leaseTypes: ['Anyone'], photos: [], url: 'https://99a/x', addedAt: 102, locality: 'Hadapsar',
      raw: { PROP_ID: 'C9', BEDROOM_NUM: '2', PROP_HEADING: 'City junk', LOCALITY: 'Hadapsar, Pune', PRICE: '22,000', MAP_DETAILS: { LATITUDE: '18.53', LONGITUDE: '73.86', SOURCE: 'CITY', ZOOM_LEVEL: '11' }, RENTAL_ATTRIBUTES: { occ_r: 'AN' }, PD_URL: '/rent/c', CLASS: 'O' } },
    { id: 'mb_333', source: 'Magicbricks', type: '2 BHK', rent: 24000, lat: 18.5185, lng: 73.93, straight: 0.8, driveMin: 12, driveKm: 3, leaseTypes: [], photos: [], url: 'https://www.magicbricks.com/OLD-SLUG&id=4d42', addedAt: 103, locality: 'Hadapsar',
      raw: { id: 333, propertyTitle: 'MB keeper', price: '24000', bedroomD: '2', lmtDName: 'Hadapsar', ltcoordGeo: '18.5160,73.9265', pmtLat: '18.5185', pmtLong: '73.9300', userType: 'Agent', url: 'OLD-SLUG&id=4d42' } },
    { id: 'nb_S1', source: 'NoBroker', type: '1 BHK', rent: 15000, lat: 18.515, lng: 73.925, leaseTypes: [], photos: [], url: '#', addedAt: 104, locality: 'Hadapsar', title: 'Alpha Heights',
      raw: { id: 'S1', propertyTitle: 'Alpha Heights', typeDesc: '1 BHK', locality: 'Hadapsar', rent: 15000, latitude: '18.5150', longitude: '73.9250', leaseTypeNew: [], detailUrl: '/s/1' } },
    { id: 'nb_S2', source: 'NoBroker', type: '1 BHK', rent: 15500, lat: 18.515, lng: 73.925, leaseTypes: [], photos: [], url: '#', addedAt: 105, locality: 'Hadapsar', title: 'Beta Residency',
      raw: { id: 'S2', propertyTitle: 'Beta Residency', typeDesc: '1 BHK', locality: 'Hadapsar', rent: 15500, latitude: '18.5150', longitude: '73.9250', leaseTypeNew: [], detailUrl: '/s/2' } },
    { id: 'nb_S3', source: 'NoBroker', type: '1 BHK', rent: 16000, lat: 18.515, lng: 73.925, leaseTypes: [], photos: [], url: '#', addedAt: 106, locality: 'Hadapsar', title: 'Gamma Court',
      raw: { id: 'S3', propertyTitle: 'Gamma Court', typeDesc: '1 BHK', locality: 'Hadapsar', rent: 16000, latitude: '18.5150', longitude: '73.9250', leaseTypeNew: [], detailUrl: '/s/3' } },
    { id: 'x_noraw', source: 'NoBroker', type: '2 BHK', rent: 18000, leaseTypes: [], photos: [], url: 'https://keep/me', addedAt: 107, locality: 'Hadapsar' }
  ] };
  await $4('importFile').onchange({ target: { files: [{ text: async () => JSON.stringify(oldStyle) }], value: '' } });
  await sleep(150);
  $4('recal').click();
  for (let i = 0; i < 30 && $4('recal').disabled; i++) await sleep(100);
  await sleep(150);
  const m4 = $4('msg').textContent;
  ok(/Recalibrated 6 listings/.test(m4) && /1 kept as-is/.test(m4) && /1 pins moved/.test(m4), 'recalibration report: 6 redone, 1 no-raw kept, 1 pin moved', m4);
  rows = await idbAll();
  const R1 = rows.find(r => r.id === 'nb_R1');
  ok(R1.postedBy === 'Owner' && R1.driveMin === 7 && !('isNew' in R1), 'unchanged pin: postedBy backfilled, road time preserved, isNew gone', JSON.stringify({p:R1.postedBy,d:R1.driveMin}));
  const C9 = rows.find(r => r.id === '99a_C9');
  ok(C9.lat === null && C9.coordBad === true && C9.driveMin == null, 'CITY-grade record imported by old code: coords and fake 99-min drive wiped', JSON.stringify({lat:C9.lat,d:C9.driveMin}));
  const M3 = rows.find(r => r.id === 'mb_333');
  ok(M3.url.includes('/propertyDetails/') && M3.postedBy === 'Agent' && M3.driveMin === 12, 'MB record: url rebuilt, postedBy filled, road time kept (same pin)', JSON.stringify({u:M3.url.slice(28,45),d:M3.driveMin}));
  ok(['nb_S1','nb_S2','nb_S3'].every(id => rows.find(r => r.id === id).coordShared === true), 'shared reference pin across 3 societies flagged');
  ok((d4.getElementById('grid').innerHTML.match(/shared pin/g) || []).length >= 3, 'shared-pin badges render');
  const NR = rows.find(r => r.id === 'x_noraw');
  ok(NR.url === 'https://keep/me' && NR.rent === 18000, 'record without raw left untouched');

  console.log('T11: user pin override - verify, reject, survive recalibration');
  w4.state.fetch = async (url) => {
    if (url.includes('api.tomtom.com')) return { status: 200, json: async () => ({ routes: [{ summary: { travelTimeSeconds: 1500 } }] }) };
    const n = (url.match(/sources=([^&]*)/)[1].split(';')).length;
    return { status: 200, json: async () => ({ code: 'Ok', durations: Array.from({length:n},()=>[600]), distances: Array.from({length:n},()=>[5000]) }) };
  };
  w4.state.promptValue = '18.5250, 73.9550';
  d4.querySelector('article[data-id="nb_R1"] .pf').click();
  for (let i = 0; i < 30; i++) { rows = await idbAll(); if (rows.find(r => r.id === 'nb_R1').pinLock === 'verified' && rows.find(r => r.id === 'nb_R1').driveMin != null) break; await sleep(100); }
  let vr = rows.find(r => r.id === 'nb_R1');
  ok(vr.pinLock === 'verified' && Math.abs(vr.lat - 18.5250) < 1e-6 && vr.coordGeocoded === true && vr.driveMin === 10, 'pasted Google coords verified + road time refetched', JSON.stringify({lat:vr.lat,d:vr.driveMin}));
  ok(d4.getElementById('grid').innerHTML.includes('verified pin'), 'verified badge renders');
  w4.state.promptValue = 'x';
  d4.querySelector('article[data-id="mb_333"] .pf').click();
  await sleep(200);
  rows = await idbAll();
  const rj = rows.find(r => r.id === 'mb_333');
  ok(rj.pinLock === 'rejected' && rj.lat === null && rj.coordBad === true && rj.driveMin == null, 'rejected pin nulled with its fake drive time', JSON.stringify({lat:rj.lat}));
  w4.state.promptValue = 'garbage input';
  d4.querySelector('article[data-id="99a_C9"] .pf').click();
  await sleep(200);
  ok(/Could not read/.test($4('msg').textContent), 'unparseable input refused with guidance');
  $4('recal').click();
  for (let i = 0; i < 30 && $4('recal').disabled; i++) await sleep(100);
  await sleep(150);
  rows = await idbAll();
  vr = rows.find(r => r.id === 'nb_R1');
  const rj2 = rows.find(r => r.id === 'mb_333');
  ok(Math.abs(vr.lat - 18.5250) < 1e-6 && vr.pinLock === 'verified' && vr.driveMin === 10, 'verified pin SURVIVES recalibration (raw says 18.5162, override wins)', JSON.stringify({lat:vr.lat}));
  ok(rj2.lat === null && rj2.pinLock === 'rejected', 'rejected pin survives recalibration');

  console.log('T12: live-capture bridge message ingestion');
  const ackP = new Promise(res => dom.window.addEventListener('message', ev => { if (ev.data && ev.data.type === 'nbtb-ack') res(ev.data); }));
  const capEntry = { url: 'https://www.nobroker.in/api/v3/multi/property/RENT/filter?live=1',
    text: JSON.stringify({ data: [{ id: 'LIVE1', propertyTitle: 'Live Capture', typeDesc: '2 BHK', locality: 'Hadapsar', rent: 19500, latitude: '18.5158', longitude: '73.9262', leaseTypeNew: ['ANYONE'], detailUrl: '/live/1' }] }) };
  dom.window.postMessage({ type: 'nbtb-captures', token: 'tok1', entries: [capEntry] }, '*');
  const ack = await Promise.race([ackP, sleep(3000).then(() => null)]);
  ok(!!ack && ack.token === 'tok1' && ack.added === 1, 'bridge message ingested and acked', JSON.stringify(ack));
  rows = await idbAll();
  const lv = rows.find(r => r.id === 'nb_LIVE1');
  ok(!!lv && lv.source === 'NoBroker' && lv.postedBy === 'Owner' && !('isNew' in lv), 'live-captured listing persisted through the normal pipeline', JSON.stringify(lv && { s: lv.source }));
  ok(/Live capture synced/.test(msg()), 'sync toast shown', msg());

  console.log('T13: persistent new / changed / unchanged classification');
  const w5 = makeDom();
  await sleep(800);
  const d5 = w5.dom.window.document, $5 = id => d5.getElementById(id);
  $5('clear').click(); await sleep(150);
  const mkT13 = (id, rent, extra) => Object.assign({ id, propertyTitle: 'Rec ' + id, typeDesc: '2 BHK', locality: 'Hadapsar', rent, latitude: '18.5162', longitude: '73.9269', leaseTypeNew: ['BACHELOR'], detailUrl: '/x/' + id }, extra || {});
  const harT13a = { log: { entries: [{ request: { url: 'https://www.nobroker.in/api/v3/multi/property/RENT/filter?p=1' },
    response: { content: { text: JSON.stringify({ data: [mkT13('A1', 20000), mkT13('B2', 25000)] }) } } }] } };
  await $5('harFile').onchange({ target: { files: [{ text: async () => JSON.stringify(harT13a) }], value: '' } });
  await sleep(200);
  rows = await idbAll();
  ok(rows.length === 2 && rows.every(r => r.syncState === 'new'), 'first capture: both classified new', JSON.stringify(rows.map(r => r.syncState)));
  ok(/2 new · 0 changed/.test($5('msg').textContent), 'toast reports new/changed/unchanged', $5('msg').textContent);

  // second capture: A1 price drops, B2 identical
  const harT13b = { log: { entries: [{ request: { url: 'https://www.nobroker.in/api/v3/multi/property/RENT/filter?p=2' },
    response: { content: { text: JSON.stringify({ data: [mkT13('A1', 18000), mkT13('B2', 25000)] }) } } }] } };
  await $5('harFile').onchange({ target: { files: [{ text: async () => JSON.stringify(harT13b) }], value: '' } });
  await sleep(200);
  rows = await idbAll();
  const a1 = rows.find(r => r.id === 'nb_A1'), b2 = rows.find(r => r.id === 'nb_B2');
  ok(a1.syncState === 'updated' && a1.rentPrev === 20000 && a1.rent === 18000, 'price change -> updated, previous rent kept', JSON.stringify({ s: a1.syncState, p: a1.rentPrev }));
  ok(b2.syncState === 'same' && b2.rentPrev == null, 'identical record -> same, no phantom change', JSON.stringify({ s: b2.syncState }));
  ok(/0 new · 1 changed · 1 unchanged/.test($5('msg').textContent), 'counts split correctly', $5('msg').textContent);
  const g5 = $5('grid').innerHTML;
  ok(g5.includes('was ₹20,000') || /was ₹20/.test(g5), 'price-drop badge shows the old rent', g5.slice(g5.indexOf('pbadge'), g5.indexOf('pbadge') + 120));
  ok(g5.includes('pbadge down'), 'drop rendered as a down badge');
  ok($5('filterGrid').innerHTML.includes('Since last capture'), 'syncState filter block present');
  const chipT13 = [...d5.querySelectorAll('[data-cat="syncState"] .opt')].find(o => o.dataset.v === 'updated');
  ok(!!chipT13 && chipT13.querySelector('.ct').textContent === '1', 'updated chip counts 1', chipT13 && chipT13.textContent);
  chipT13.click(); await sleep(120);
  ok($5('s-shown').textContent === '1', 'filtering by updated isolates the changed listing', $5('s-shown').textContent);
  $5('resetFilters').click(); await sleep(120);

  // recalibrate must not wipe capture history (it is not in the raw payload)
  $5('recal').click();
  for (let i = 0; i < 30 && $5('recal').disabled; i++) await sleep(100);
  await sleep(150);
  rows = await idbAll();
  const a1b = rows.find(r => r.id === 'nb_A1');
  ok(a1b.rentPrev === 20000 && a1b.syncState === 'updated', 'recalibration preserves rentPrev/syncState', JSON.stringify({ p: a1b.rentPrev, s: a1b.syncState }));

  console.log('T14: configurable destination');
  const w6 = makeDom();
  await sleep(800);
  const d6 = w6.dom.window.document, $6 = id => d6.getElementById(id);
  $6('clear').click(); await sleep(150);
  w6.state.fetch = async (url) => {
    if (url.includes('api.tomtom.com')) return { status: 200, json: async () => ({ routes: [{ summary: { travelTimeSeconds: 1500 } }] }) };
    const n = (url.match(/sources=([^&]*)/)[1].split(';')).length;
    return { status: 200, json: async () => ({ code: 'Ok', durations: Array.from({length:n},()=>[600]), distances: Array.from({length:n},()=>[5000]) }) };
  };
  ok(!!$6('destCoords') && !!$6('destLabel') && !!$6('destSave'), 'destination controls render');
  const harD = { log: { entries: [{ request: { url: 'https://www.nobroker.in/api/v3/multi/property/RENT/filter?d=1' },
    response: { content: { text: JSON.stringify({ data: [{ id: 'D1', propertyTitle: 'Dest test', typeDesc: '2 BHK', locality: 'Hadapsar', rent: 20000, latitude: '18.5162', longitude: '73.9269', leaseTypeNew: ['ANYONE'], detailUrl: '/d/1' }] }) } } }] } };
  await $6('harFile').onchange({ target: { files: [{ text: async () => JSON.stringify(harD) }], value: '' } });
  await sleep(200);
  let dr = (await idbAll()).find(r => r.id === 'nb_D1');
  const farStraight = dr.straight;
  ok(farStraight > 6, 'with the default (city centre) destination the listing is far', String(farStraight));
  $6('road').click();
  for (let i = 0; i < 30 && $6('road').disabled; i++) await sleep(100);
  dr = (await idbAll()).find(r => r.id === 'nb_D1');
  ok(dr.driveMin === 10, 'road time fetched against the default destination');
  // now point it at the office
  $6('destLabel').value = 'My office';
  $6('destCoords').value = '18.5160, 73.9270';
  $6('destSave').click();
  await sleep(400);
  dr = (await idbAll()).find(r => r.id === 'nb_D1');
  ok(dr.straight < 1 && dr.straight !== farStraight, 'straight-line recomputed to the new destination', String(dr.straight));
  ok(dr.driveMin == null && dr.driveKm == null, 'stale road times measured to the OLD point are cleared, not kept');
  ok(d6.getElementById('destName').textContent === 'My office', 'header shows the destination label');
  ok(/Fetch road times/.test($6('msg').textContent), 'user told to refetch commutes', $6('msg').textContent);
  $6('destCoords').value = 'not coordinates';
  $6('destSave').click(); await sleep(120);
  ok(/Paste coordinates/.test($6('msg').textContent), 'garbage coordinates refused');
  // persistence: jsdom gives each window its own localStorage, so assert the
  // actual contract - the destination is written to the config the tool reloads from
  const savedCfg = JSON.parse(w6.dom.window.localStorage.getItem('nb_cfg_v1') || '{}');
  ok(savedCfg.dest && Math.abs(savedCfg.dest.lat - 18.5160) < 1e-6 && savedCfg.dest.label === 'My office',
     'destination persisted to config for the next reload', JSON.stringify(savedCfg.dest));

  console.log('T15: postedAt / status / freshness sorts');
  { const { dom } = makeDom(); await sleep(800);
    const d = dom.window.document, $ = id => d.getElementById(id), w = dom.window;
    $('clear').click(); await sleep(120);
    const now = Date.now();
    const har = { log: { entries: [{ request:{url:'https://www.nobroker.in/api/v3/multi/property/RENT/filter?p=1'},
      response:{content:{text: JSON.stringify({ data:[
        { id:'PA1', propertyTitle:'Fresh', typeDesc:'2 BHK', locality:'Hadapsar', rent:20000, latitude:'18.5162', longitude:'73.9269', leaseTypeNew:['ANYONE'], detailUrl:'/x/1', activationDate: now-3*86400000, active:true },
        { id:'PA2', propertyTitle:'Stale', typeDesc:'2 BHK', locality:'Hadapsar', rent:21000, latitude:'18.5162', longitude:'73.9269', leaseTypeNew:['ANYONE'], detailUrl:'/x/2', activationDate: now-90*86400000, active:false, inactiveReason:'TIMED_OUT' }
      ]})}} }]}};
    await $('harFile').onchange({ target:{ files:[{ text: async()=>JSON.stringify(har) }], value:'' } });
    await sleep(250);
    const rows = await idbAll();
    const a1 = rows.find(r=>r.id==='nb_PA1'), a2 = rows.find(r=>r.id==='nb_PA2');
    ok(a1 && Math.abs(a1.postedAt-(now-3*86400000))<2000, 'postedAt parsed from activationDate', a1 && a1.postedAt);
    ok(a2 && a2.active===false && a2.inactiveReason==='TIMED_OUT', 'inactive listing keeps portal reason', a2 && a2.inactiveReason);
    ok(w.eval('statusOf')(a1)==='active' && w.eval('statusOf')(a2)==='inactive', 'statusOf classifies active vs inactive');
    const F = w.eval('FIELDS');
    ok(!!F.postedAt && !!F.addedAt && F.addedAt.label!==F.postedAt.label, 'both time sorts registered with distinct labels', [F.addedAt.label, F.postedAt.label]);
    ok(w.eval('daysSince')(a1.postedAt)===3, 'daysSince computes posted age');
    // inactive card is greyed + badged once rendered
    const g = $('grid').innerHTML;
    ok(/card[^"]*dim/.test(g), 'inactive listing card is greyed (dim class)');
    ok(g.includes('inactive'), 'inactive badge shown on card');
  }

  console.log('T16: manual remove / restore');
  { const { dom } = makeDom(); await sleep(800);
    const d = dom.window.document, $ = id => d.getElementById(id);
    $('clear').click(); await sleep(120);
    const har = { log: { entries: [{ request:{url:'https://www.nobroker.in/api/v3/multi/property/RENT/filter?p=1'},
      response:{content:{text: JSON.stringify({ data:[
        { id:'RM1', propertyTitle:'Keep', typeDesc:'2 BHK', locality:'Hadapsar', rent:20000, latitude:'18.5162', longitude:'73.9269', leaseTypeNew:['ANYONE'], detailUrl:'/x/1' },
        { id:'RM2', propertyTitle:'Rented', typeDesc:'2 BHK', locality:'Hadapsar', rent:21000, latitude:'18.5162', longitude:'73.9269', leaseTypeNew:['ANYONE'], detailUrl:'/x/2' }
      ]})}} }]}};
    await $('harFile').onchange({ target:{ files:[{ text: async()=>JSON.stringify(har) }], value:'' } });
    await sleep(250);
    ok($('grid').querySelectorAll('article').length===2, 'both cards shown initially', $('grid').querySelectorAll('article').length);
    const rm = d.querySelector('[data-rm="nb_RM2"]');
    ok(!!rm, 'remove button present on card');
    rm.click(); await sleep(200);
    let rows = await idbAll();
    ok(rows.find(r=>r.id==='nb_RM2').removed===true, 'clicking remove sets removed=true (persisted)');
    ok($('grid').querySelectorAll('article').length===1, 'removed card hidden by default', $('grid').querySelectorAll('article').length);
    // recalibration keeps it removed
    $('recal').click();
    for (let i=0;i<30 && $('recal').disabled;i++) await sleep(100);
    await sleep(150);
    rows = await idbAll();
    ok(rows.find(r=>r.id==='nb_RM2').removed===true, 'removal survives recalibration');
  }

  console.log('T17: header menus consolidate the toolbar');
  { const { dom } = makeDom(); await sleep(800);
    const d = dom.window.document, $ = id => d.getElementById(id);
    ok(!!$('dataMenuBtn') && !!$('viewMenuBtn'), 'Data and View menu buttons exist');
    ok(!!$('export') && !!$('exportJson') && !!$('importJson') && !!$('recal') && !!$('roadAll'), 'all original action ids preserved inside menus');
    ok($('dataMenu').hidden === true, 'data menu starts hidden');
    $('dataMenuBtn').click(); await sleep(60);
    ok($('dataMenu').hidden === false, 'clicking Data opens the menu');
    ok(!!$('road'), 'Fetch road times stays a top-level button');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
