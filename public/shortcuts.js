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

/* A double-click or an impatient second tap on Save used to post the same form twice
   (two payments, two follow-ups). Once a POST form is on its way, further submits of it
   are ignored. Buttons aren't disabled: a disabled submit button drops its name/value. */
document.addEventListener('submit', e => {
  const form = e.target;
  if (e.defaultPrevented || !(form instanceof HTMLFormElement)) return;
  if ((form.method || '').toLowerCase() !== 'post' || form.target === '_blank') return;
  if (form.dataset.submitting) { e.preventDefault(); return; }
  form.dataset.submitting = '1';
  form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]').forEach(b => { if (!b.classList.contains('disabled')) { b.classList.add('disabled'); b.dataset.busy = '1'; } });
});
// Coming back with the browser's Back button restores the page as it was; let it submit again.
window.addEventListener('pageshow', () => {
  document.querySelectorAll('form[data-submitting]').forEach(f => {
    delete f.dataset.submitting;
    f.querySelectorAll('[data-busy]').forEach(b => { b.classList.remove('disabled'); delete b.dataset.busy; });
  });
});
