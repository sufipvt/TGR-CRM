/* Lead panel: clicking a lead's name on the Leads page opens the side panel
   with quick actions, key facts and the activity timeline (tgShowTimeline in
   app.js). Everything is set with textContent / attributes, never innerHTML. */

function tgOpenLead(lead) {
  const sub = document.getElementById('lpSub');
  const head = document.getElementById('lpHead');
  if (!sub || !head) return tgShowTimeline(lead.id, lead.name);

  // Subtitle: status chip, temperature, phone
  sub.replaceChildren();
  const chip = document.createElement('span');
  chip.className = 'tg-chip tg-chip-' + String(lead.status || '').toLowerCase().replace(/ /g, '-');
  chip.textContent = lead.status;
  sub.append(chip);
  if (lead.temperature) {
    const t = document.createElement('span');
    t.className = 'tg-temp tg-temp-' + lead.temperature.toLowerCase();
    t.textContent = lead.temperature;
    sub.append(t);
  }
  const ph = document.createElement('span');
  ph.textContent = lead.phone;
  sub.append(ph);
  sub.hidden = false;

  // Quick actions. Call / WhatsApp keep phone.js's "how did the call go?" prompt.
  const call = document.getElementById('lpCall');
  const wa = document.getElementById('lpWa');
  [[call, lead.tel], [wa, lead.wa]].forEach(([a, href]) => {
    a.hidden = !href;
    a.setAttribute('href', href || '#');
    if (lead.canEdit) { a.dataset.logCall = lead.id; a.dataset.leadName = lead.name; }
    else { delete a.dataset.logCall; delete a.dataset.leadName; }
  });
  const edit = document.getElementById('lpEdit');
  const rowEdit = document.querySelector('[data-edit-for="' + CSS.escape(lead.id) + '"]');
  edit.hidden = !rowEdit;
  edit.onclick = () => {
    bootstrap.Offcanvas.getInstance(document.getElementById('timelineOffcanvas'))?.hide();
    rowEdit?.click();
  };

  // Facts
  const facts = document.getElementById('lpFacts');
  facts.replaceChildren();
  [['Project', lead.project], ['Source', lead.source], ['Caller', lead.caller], ['Closer', lead.closer],
   ['Budget', lead.budget], ['City', lead.city], ['Added', lead.created]].forEach(([k, v]) => {
    if (!v) return;
    const wrap = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    wrap.append(dt, dd);
    facts.append(wrap);
  });
  head.hidden = false;

  tgShowTimeline(lead.id, lead.name);
  const title = document.getElementById('timelineTitle');
  if (title) title.textContent = lead.name;
}

// The row's Timeline button opens the same panel without the lead header.
document.addEventListener('DOMContentLoaded', () => {
  const oc = document.getElementById('timelineOffcanvas');
  oc?.addEventListener('hidden.bs.offcanvas', () => {
    document.getElementById('lpHead').hidden = true;
    document.getElementById('lpSub').hidden = true;
  });
});
