/* Status tabs on the Follow-ups and Bookings pages (nav[data-tabs]).
   A tab either shows its matching [data-tab-panel] section, or, when the nav
   names an input in data-tab-input, puts its value there and fires "input"
   so the page's own filter runs. */
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tabs] [data-tab]');
  if (!tab) return;
  const nav = tab.closest('[data-tabs]');
  nav.querySelectorAll('[data-tab]').forEach(b => {
    const on = b === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const inputId = nav.dataset.tabInput;
  if (inputId) {
    const input = document.getElementById(inputId);
    if (input) { input.value = tab.dataset.tab; input.dispatchEvent(new Event('input')); }
    return;
  }
  document.querySelectorAll('[data-tab-panel]').forEach(p => { p.hidden = p.dataset.tabPanel !== tab.dataset.tab; });
});
