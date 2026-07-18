const $ = id => document.getElementById(id);
const refresh = () => chrome.storage.local.get({ captures: [] }, st => {
  $('n').textContent = st.captures.length;
  $('sz').textContent = (JSON.stringify(st.captures).length / 1e6).toFixed(1) + ' MB';
});
chrome.storage.local.get({ runUrls: [] }, st => { $('urls').value = st.runUrls.join('\n'); });
$('urls').addEventListener('change', () => {
  const runUrls = $('urls').value.split('\n').map(s => s.trim()).filter(Boolean);
  chrome.storage.local.set({ runUrls });
});
$('run').onclick = () => {
  const runUrls = $('urls').value.split('\n').map(s => s.trim()).filter(Boolean);
  chrome.storage.local.set({ runUrls }, () => chrome.tabs.create({ url: chrome.runtime.getURL('runner.html') }));
};
$('dl').onclick = () => chrome.storage.local.get({ captures: [] }, st => {
  if (!st.captures.length) return;
  const har = { log: { version: '1.2', creator: { name: 'capture-bridge', version: '1.0' }, entries: st.captures.map(x => ({ request: { url: x.url }, response: { content: { text: x.text } } })) } };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(har)], { type: 'application/json' }));
  a.download = 'capture_' + new Date().toISOString().slice(0, 10) + '.har';
  a.click();
});
$('clr').onclick = () => chrome.storage.local.set({ captures: [] }, refresh);
refresh();

$('rst').onclick = () => chrome.storage.local.get(null, all => {
  const keys = Object.keys(all).filter(k => k.indexOf('a99prog:') === 0);
  chrome.storage.local.remove(keys, () => { $('rst').textContent = keys.length ? `Cleared ${keys.length} resume point(s)` : 'No resume points'; setTimeout(() => { $('rst').textContent = 'Reset 99acres resume points'; }, 1800); });
});

// Today's self-imposed budget per portal - the limit is only useful if visible.
const CAPS = { 'www.99acres.com': 45, 'www.nobroker.in': 300, 'www.magicbricks.com': 300, 'housing.com': 300, 'www.squareyards.com': 300 };
chrome.storage.local.get(null, all => {
  const now = Date.now(), lines = [];
  for (const [host, cap] of Object.entries(CAPS)) {
    const hits = (all['rl:' + host] || []).filter(t => now - t < 86400000);
    if (!hits.length) continue;
    const short = host.replace('www.', '').replace('.com', '');
    lines.push(`${short}: ${hits.length}/${cap} today${hits.length >= cap ? ' — done for today' : ''}`);
  }
  $('bud').textContent = lines.length ? 'Page loads used: ' + lines.join(' · ') : '';
});
