const badge = () => chrome.storage.local.get({ captures: [] }, st => {
  const n = st.captures.length;
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#2B6FD4' });
});
chrome.runtime.onInstalled.addListener(badge);
chrome.runtime.onStartup.addListener(badge);
chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && ch.captures) badge(); });
