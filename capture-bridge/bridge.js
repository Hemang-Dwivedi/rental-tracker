// Runs on file:// pages; activates only on the Rental Tracker. Delivers
// stored captures into the page and clears them once the tracker acks.
(() => {
  const isTracker = () => document.getElementById('grid') && document.getElementById('harFile') && /rental tracker/i.test(document.title);
  if (!isTracker()) return;
  let busy = false;
  const deliver = () => {
    if (busy) return;
    chrome.storage.local.get({ captures: [] }, st => {
      const all = st.captures;
      if (!all.length) return;
      busy = true;
      const batch = all.slice(0, 40);
      const token = 't' + Date.now() + Math.random().toString(36).slice(2);
      const onAck = ev => {
        const m = ev && ev.data;
        if (!m || m.type !== 'nbtb-ack' || m.token !== token) return;
        window.removeEventListener('message', onAck);
        const ids = new Set(batch.map(x => x.id));
        chrome.storage.local.get({ captures: [] }, s2 => {
          chrome.storage.local.set({ captures: s2.captures.filter(x => !ids.has(x.id)) }, () => { busy = false; setTimeout(deliver, 400); });
        });
      };
      window.addEventListener('message', onAck);
      window.postMessage({ type: 'nbtb-captures', token, entries: batch.map(x => ({ url: x.url, text: x.text })) }, '*');
      setTimeout(() => { window.removeEventListener('message', onAck); busy = false; }, 15000);
    });
  };
  setTimeout(deliver, 1000);
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.captures) setTimeout(deliver, 300); });
})();
