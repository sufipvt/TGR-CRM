/* Larger text: the "AA" button in the top bar. The choice is kept per device
   in localStorage; the <head> script applies it before the page paints. */
function tgToggleText() {
  const html = document.documentElement;
  const large = html.getAttribute('data-text') !== 'large';
  if (large) html.setAttribute('data-text', 'large'); else html.removeAttribute('data-text');
  try { if (large) localStorage.setItem('tgText', 'large'); else localStorage.removeItem('tgText'); } catch (e) { /* private mode */ }
  tgApplyTextButton();
}
function tgApplyTextButton() {
  const btn = document.getElementById('tgTextToggle');
  if (!btn) return;
  const large = document.documentElement.getAttribute('data-text') === 'large';
  btn.setAttribute('aria-pressed', String(large));
  btn.title = large ? 'Normal text' : 'Larger text';
}
document.addEventListener('DOMContentLoaded', tgApplyTextButton);
