/* The notification bell: polls for new alerts, shows a desktop alert when allowed,
   and marks everything read when the list is opened. Loaded on every app page. */
(function () {
  const POLL_MS = 60 * 1000;
  let lastUnread = null;
  const baseTitle = document.title;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Only our own /app links, never anything a stored value could turn into a script URL.
  const safeLink = l => (typeof l === 'string' && l.startsWith('/app?') ? l : '#');

  function setCount(n) {
    const badge = document.getElementById('tgBellCount');
    if (!badge) return;
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : String(n);
    document.title = n ? '(' + n + ') ' + baseTitle : baseTitle;
  }

  function render(items) {
    const list = document.getElementById('tgBellList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="tg-bell-empty">No notifications yet. New enquiries will show up here.</div>';
      return;
    }
    list.innerHTML = items.map(n =>
      '<a class="tg-bell-item' + (n.read ? '' : ' unread') + '" href="' + esc(safeLink(n.link)) + '">' +
        '<div class="tg-bell-title">' + esc(n.title) + '</div>' +
        '<div class="tg-bell-meta">' + esc(n.body) + ' · ' + esc(n.when) + '</div>' +
      '</a>'
    ).join('');
  }

  function desktopAlert(items, count) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const newest = items.find(n => !n.read);
    if (!newest) return;
    const n = new Notification(count > 1 ? newest.title + ' (+' + (count - 1) + ' more)' : newest.title, { body: newest.body, tag: 'tg-leads' });
    n.onclick = () => { window.focus(); window.location.href = safeLink(newest.link); };
  }

  async function poll() {
    if (document.hidden) return;
    try {
      const res = await fetch('/api/notifications', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      if (lastUnread !== null && data.unread > lastUnread) desktopAlert(data.items, data.unread - lastUnread);
      lastUnread = data.unread;
      setCount(data.unread);
      render(data.items);
    } catch (e) { /* offline or signed out: try again next round */ }
  }

  async function markRead() {
    const badge = document.getElementById('tgBellCount');
    if (!badge || badge.hidden) return;
    try {
      const res = await fetch('/api/notifications/read', { method: 'POST', headers: { accept: 'application/json' } });
      if (res.ok) { lastUnread = 0; setCount(0); }
    } catch (e) { /* stays unread; next poll shows the real count */ }
  }

  window.tgEnableDesktopAlerts = async function () {
    if (!('Notification' in window)) return;
    await Notification.requestPermission();
    const btn = document.getElementById('tgBellDesktop');
    if (btn) btn.hidden = Notification.permission !== 'default';
  };

  document.addEventListener('DOMContentLoaded', () => {
    const bell = document.getElementById('tgBell');
    if (!bell) return;
    const badge = document.getElementById('tgBellCount');
    lastUnread = badge && !badge.hidden ? parseInt(badge.textContent, 10) || 0 : 0;
    setCount(lastUnread);
    const btn = document.getElementById('tgBellDesktop');
    if (btn && 'Notification' in window && Notification.permission === 'default') btn.hidden = false;
    // Opening the list counts as reading it; the dots stay until the next refresh.
    bell.addEventListener('shown.bs.dropdown', markRead);
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  });
})();
