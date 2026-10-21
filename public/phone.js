/* Phone-first helpers:
   1. Registers the service worker so the CRM can be installed as an app.
   2. Shows "Install app" in the menu when the browser offers it.
   3. After someone taps Call or WhatsApp on a lead and comes back, asks how it
      went (partials/call-log-modal.ejs) so the call is logged while it's fresh. */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvent = e;
    const btn = document.getElementById('tgInstallApp');
    if (btn) btn.hidden = false;
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#tgInstallApp') || !installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.finally(() => {
      installEvent = null;
      document.getElementById('tgInstallApp').hidden = true;
    });
  });

  // The pending call is kept in sessionStorage so it survives the phone reloading
  // the page while the dialer or WhatsApp was open.
  const KEY = 'tgPendingCall';
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const write = v => { try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch (e) { /* private mode */ } };

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-log-call]');
    if (!a) return;
    write({ id: a.dataset.logCall, name: a.dataset.leadName || '', via: a.dataset.via || 'Call', at: Date.now(), left: false });
  });

  // Only ask once the person actually went to the dialer or WhatsApp. On a computer
  // with nothing set up for phone links, nothing happens, so nothing is asked.
  function markLeft() {
    const p = read();
    if (p && !p.left && Date.now() - p.at < 60 * 1000) { p.left = true; write(p); }
  }
  function maybeAsk() {
    if (document.visibilityState !== 'visible') return;
    const p = read();
    if (!p) return;
    if (Date.now() - p.at > MAX_AGE_MS) { write(null); return; }
    if (!p.left) return;
    write(null);
    ask(p);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') markLeft(); else maybeAsk(); });
  window.addEventListener('blur', markLeft);
  window.addEventListener('focus', maybeAsk);
  window.addEventListener('pageshow', () => setTimeout(maybeAsk, 300));

  function ask(p) {
    const modalEl = document.getElementById('callLogModal');
    const form = document.getElementById('callLogForm');
    if (!modalEl || !form || !window.bootstrap) return;
    form.reset();
    // Post back to this same page and list, so the person lands where they were.
    form.action = location.pathname + location.search;
    document.getElementById('callLogLead').value = p.id;
    document.getElementById('callLogVia').value = p.via === 'WhatsApp' ? 'WhatsApp' : 'Call';
    document.getElementById('callLogName').textContent = p.name;
    document.getElementById('callLogTitle').textContent = p.via === 'WhatsApp' ? 'How did the WhatsApp chat go?' : 'How did the call go?';
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }
  // Exposed for tests and for a manual "log a call" button later.
  window.tgAskCallOutcome = ask;
})();
