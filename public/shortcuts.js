/* Links like /app?page=leads#new open that page's form straight away (used by the
   dashboard's quick buttons). The page marks its buttons with data-quick="new". */
document.addEventListener('DOMContentLoaded', () => {
  const key = (location.hash || '').slice(1);
  if (!/^[a-z]+$/.test(key)) return;
  const btn = document.querySelector('[data-quick="' + key + '"]');
  if (!btn) return;
  history.replaceState(null, '', location.pathname + location.search);
  // Bootstrap's script is deferred too; wait a tick so its click handler is ready.
  setTimeout(() => btn.click(), 0);
});
