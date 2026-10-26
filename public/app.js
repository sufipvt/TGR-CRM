// CRM client-side JS
// Charts, filters, timeline offcanvas, dynamic unit loading, CSV helpers, modal edit forms.

const fmt = {
  money: n => '\u20B9' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
};

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val == null ? '' : val;
}
/* ============================ THEME TOGGLE ============================ */
function tgApplyThemeIcon() {
  const theme = document.documentElement.getAttribute('data-bs-theme') || 'light';
  const icon = document.getElementById('tgThemeIcon');
  if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

function tgToggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-bs-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-bs-theme', next);
  try { localStorage.setItem('tgTheme', next); } catch(e) {}
  tgApplyThemeIcon();
  tgRenderCharts();
}

document.addEventListener('DOMContentLoaded', tgApplyThemeIcon);


/* ============================ DASHBOARD CHARTS ============================ */
let _tgTrendChart = null;
let _tgStatusChart = null;

function tgChartColors() {
  const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  return {
    tick:           dark ? '#94a3b8' : '#6b7280',
    grid:           dark ? '#334155' : '#f1f5f9',
    legend:         dark ? '#e2e8f0' : '#374151',
    doughnutBorder: dark ? '#1e293b' : '#ffffff'
  };
}

function tgRenderCharts() {
  const c = tgChartColors();

  const trend = document.getElementById('trendChart');
  if (trend && window.Chart) {
    const labels = JSON.parse(trend.dataset.labels || '[]');
    const values = JSON.parse(trend.dataset.values || '[]');
    if (_tgTrendChart) _tgTrendChart.destroy();
    _tgTrendChart = new Chart(trend, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Revenue',
          data: values,
          borderColor: '#1a56db',
          backgroundColor: 'rgba(26,86,219,0.08)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: '#1a56db'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: c.tick, callback: v => fmt.money(v) }, grid: { color: c.grid } },
          x: { ticks: { color: c.tick }, grid: { display: false } }
        }
      }
    });
  }

  const status = document.getElementById('statusChart');
  if (status && window.Chart) {
    const labels = JSON.parse(status.dataset.labels || '[]');
    const values = JSON.parse(status.dataset.values || '[]');
    const palette = {
      'New': '#1a56db', 'Working': '#d97706', 'Qualified': '#0d9488',
      'Site Visit Scheduled': '#6b7280', 'Negotiation': '#111827',
      'Booked': '#059669', 'Lost': '#dc2626', 'Not Interested': '#f87171'
    };
    if (_tgStatusChart) _tgStatusChart.destroy();
    _tgStatusChart = new Chart(status, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map(l => palette[l] || '#9ca3af'),
          borderWidth: 2,
          borderColor: c.doughnutBorder
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: c.legend } } }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  tgRenderCharts();

  // Leads filters are a GET form (server-side search + paging); see views/pages/leads.ejs

  // Bookings filters
  ['bookingSearch', 'bookingStatusFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', filterBookings);
  });

  const confirmCompleteBtn = document.getElementById('confirmCompleteBtn');
  if (confirmCompleteBtn) {
    confirmCompleteBtn.addEventListener('click', () => {
      const outcome = document.getElementById('completeOutcomeInput').value;
      const visit = document.getElementById('completeVisitOutcome');
      if (_completeFuType === 'Site Visit' && !visit.value) { visit.classList.add('is-invalid'); visit.focus(); return; }
      setVal('completeFuId', _completeFuId);
      setVal('completeFuOutcome', outcome);
      setVal('completeFuVisit', _completeFuType === 'Site Visit' ? visit.value : '');
      bootstrap.Modal.getInstance(document.getElementById('completeModal')).hide();
      document.getElementById('completeFuForm').submit();
    });
  }
});

/* ============================ LEADS PAGE ============================ */
const TG_NOT_INTERESTED_REASONS = ['Budget Mismatch','Location Mismatch','Timeline Mismatch (not buying soon)','Property Type Mismatch','Already Purchased Elsewhere','Other'];
const TG_LOST_REASONS = ['Chose a Competitor Project','Price Negotiation Failed','Financing / Loan Rejected','Changed Mind','Other'];

function tgToggleDispositionReason() {
  const status = document.getElementById('lf_status')?.value;
  const wrap = document.getElementById('lf_reason_wrap');
  const sel = document.getElementById('lf_reason');
  if (!wrap || !sel) return;
  let list = null;
  if (status === 'Not Interested') list = TG_NOT_INTERESTED_REASONS;
  else if (status === 'Lost') list = TG_LOST_REASONS;

  if (list) {
    wrap.style.display = '';
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Select reason</option>' + list.map(r => `<option value="${r}">${r}</option>`).join('');
    if (list.includes(currentVal)) sel.value = currentVal;
  } else {
    wrap.style.display = 'none';
    sel.value = '';
  }
}

function tgResetLeadForm() {
  const form = document.querySelector('#leadModal form');
  if (form) form.reset();
  setVal('leadAction', 'add_lead');
  setVal('leadId', '');
  setVal('leadVersion', '');
  const title = document.getElementById('leadModalTitle');
  if (title) title.textContent = 'Add Lead';
  tgToggleDispositionReason();
  tgCheckLeadPhone();
}

function tgEditLead(lead) {
  setVal('leadAction', 'update_lead');
  setVal('leadId', lead._id);
  setVal('leadVersion', lead.updated_at);
  setVal('lf_name', lead.name);
  setVal('lf_phone', lead.phone);
  tgShowPhoneDuplicate(null);
  setVal('lf_email', lead.email);
  setVal('lf_city', lead.city);
  setVal('lf_source', lead.source_id);
  setVal('lf_project', lead.project_id);
  setVal('lf_budget', lead.budget_range);
  setVal('lf_status', lead.status);
  setVal('lf_temperature', lead.temperature);
  setVal('lf_caller', lead.assigned_caller_id);
  setVal('lf_closer', lead.assigned_closer_id);
  setVal('lf_notes', lead.notes);
  tgToggleDispositionReason();
  setVal('lf_reason', lead.disposition_reason);
  const title = document.getElementById('leadModalTitle');
  if (title) title.textContent = 'Edit Lead';
  new bootstrap.Modal(document.getElementById('leadModal')).show();
}

/* ============================ TIMELINE OFFCANVAS ============================ */
async function tgShowTimeline(leadId, leadName) {
  const body = document.getElementById('timelineBody');
  const title = document.getElementById('timelineTitle');
  if (title) title.textContent = 'Timeline \u2014 ' + leadName;
  if (body) body.innerHTML = '<p class="text-secondary">Loading\u2026</p>';
  const oc = new bootstrap.Offcanvas(document.getElementById('timelineOffcanvas'));
  oc.show();
  try {
    const res = await fetch('/api/lead-timeline/' + leadId);
    if (!res.ok) throw new Error('Failed to load timeline');
    const events = await res.json();
    if (!events.length) {
      body.innerHTML = '<p class="text-secondary">No activity yet.</p>';
      return;
    }
    const html = events.map(e => {
      const d = new Date(e.date);
      const dateStr = d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return '<div class="tg-timeline-item">' +
        '<div class="tg-timeline-dot tg-dot-' + e.type + '"></div>' +
        '<div class="tg-timeline-label">' + escapeHtml(e.label) + '</div>' +
        (e.detail ? '<div class="tg-timeline-detail">' + escapeHtml(e.detail) + '</div>' : '') +
        '<div class="tg-timeline-date">' + dateStr + '</div>' +
        '</div>';
    }).join('');
    body.innerHTML = '<div class="tg-timeline">' + html + '</div>';
  } catch (err) {
    body.innerHTML = '<p class="text-danger">Could not load timeline.</p>';
  }
}

// Safe for both element text and quoted attribute values.
/* ======================= DUPLICATE PHONE CHECK ====================== */
// Warns under the phone field when another lead has the same number. The server
// refuses the save unless "Save anyway" is ticked, so this is only a heads-up.
function tgShowPhoneDuplicate(info) {
  const box = document.getElementById('lf_phone_dup');
  if (!box) return;
  const allow = document.getElementById('lf_allow_dup');
  if (allow) allow.checked = false;
  box.hidden = !info;
  if (!info) return;
  document.getElementById('lf_phone_dup_text').textContent = info.visible
    ? 'Already a lead: ' + info.name + ' (' + info.status + (info.caller ? ', ' + info.caller : '') + ').'
    : 'This number is already a lead outside your team.';
}

let tgPhoneCheckSeq = 0;
async function tgCheckLeadPhone() {
  const input = document.getElementById('lf_phone');
  if (!input) return;
  const phone = input.value.trim();
  const seq = ++tgPhoneCheckSeq;
  if (phone.replace(/\D/g, '').length < 6) return tgShowPhoneDuplicate(null);
  const exclude = document.getElementById('leadAction')?.value === 'update_lead' ? (document.getElementById('leadId')?.value || '') : '';
  try {
    const res = await fetch('/api/lead-phone-check?phone=' + encodeURIComponent(phone) + '&exclude=' + encodeURIComponent(exclude));
    if (!res.ok || seq !== tgPhoneCheckSeq) return;
    const data = await res.json();
    tgShowPhoneDuplicate(data.duplicate ? data : null);
  } catch (e) { /* the server still checks on save */ }
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('lf_phone');
  if (input) input.addEventListener('change', tgCheckLeadPhone);
});

// Copy an input's value (Settings: enquiry link, webhook URL and key).
async function tgCopy(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.value);
    const label = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = label; }, 1500);
  } catch (e) {
    el.type = 'text';
    el.select();
  }
}

/* ============================ BULK LEAD ACTIONS ===================== */
function tgBulkChanged() {
  const n = document.querySelectorAll('.tg-bulk:checked').length;
  const bar = document.getElementById('bulkLeadForm');
  if (!bar) return;
  bar.hidden = n === 0;
  bar.classList.toggle('d-flex', n > 0);
  document.getElementById('bulkCount').textContent = n;
  const all = document.getElementById('bulkAll');
  if (all) all.checked = n > 0 && n === document.querySelectorAll('.tg-bulk').length;
}

function tgBulkSelectAll(on) {
  document.querySelectorAll('.tg-bulk').forEach(cb => { cb.checked = on; });
  tgBulkChanged();
}

function tgClearBulk() { tgBulkSelectAll(false); }

function tgConfirmBulk(form) {
  const n = document.querySelectorAll('.tg-bulk:checked').length;
  if (!form.bulk_status.value && !(form.bulk_caller_id && form.bulk_caller_id.value)) {
    alert('Choose a new status or agent first.');
    return false;
  }
  return confirm('Update ' + n + ' lead' + (n === 1 ? '' : 's') + '?');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================ CSV IMPORT ============================ */
function tgDownloadSampleCsv() {
  const csv = 'name,phone,email,city,source_name,project_name,budget_range,notes\n' +
    'Rahul Sharma,9876543210,rahul@example.com,Mumbai,Website,Sky Heights,80L - 1Cr,Interested in 3BHK\n' +
    'Priya Patel,9123456780,priya@example.com,Pune,Referral,,50L - 70L,Referred by existing customer';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'leads-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================ FOLLOW-UPS PAGE ============================ */
function tgResetFollowupForm() {
  const form = document.querySelector('#followupModal form');
  if (form) form.reset();
  setVal('fuAction', 'add_followup');
  setVal('fuId', '');
  const title = document.getElementById('followupModalTitle');
  if (title) title.textContent = 'Schedule Follow-Up';
  const sw = document.getElementById('fuStatusWrap');
  const ow = document.getElementById('fuOutcomeWrap');
  if (sw) sw.style.display = 'none';
  if (ow) ow.style.display = 'none';
}

function tgEditFollowup(f) {
  setVal('fuAction', 'update_followup');
  setVal('fuId', f._id);
  // The picker lists recent leads only; add this follow-up's lead if it isn't there.
  const leadSel = document.getElementById('fu_lead');
  if (leadSel && f.lead_id && ![...leadSel.options].some(o => o.value === f.lead_id)) leadSel.add(new Option(f.lead_label || 'Current lead', f.lead_id));
  setVal('fu_lead', f.lead_id);
  setVal('fu_type', f.type);
  setVal('fu_owner', f.assigned_to_id);
  setVal('fu_date', f.scheduled_date);
  setVal('fu_status', f.status);
  setVal('fu_outcome', f.outcome);
  setVal('fu_notes', f.notes);
  const title = document.getElementById('followupModalTitle');
  if (title) title.textContent = 'Edit Follow-Up';
  const sw = document.getElementById('fuStatusWrap');
  const ow = document.getElementById('fuOutcomeWrap');
  if (sw) sw.style.display = '';
  if (ow) ow.style.display = '';
  new bootstrap.Modal(document.getElementById('followupModal')).show();
}



let _completeFuType = '';
function tgCompleteFollowup(id, type) {
  _completeFuId = id;
  _completeFuType = type || '';
  document.getElementById('completeOutcomeInput').value = '';
  const visit = document.getElementById('completeVisitOutcome');
  visit.value = '';
  visit.classList.remove('is-invalid');
  document.getElementById('completeVisitWrap').hidden = _completeFuType !== 'Site Visit';
  new bootstrap.Modal(document.getElementById('completeModal')).show();
}

/* ===== NOT INTERESTED — REASON POPUP ===== */
let _niLeadId = null;

function tgShowNiModal(leadId, leadName) {
  _niLeadId = leadId;
  const nameEl = document.getElementById('niLeadName');
  if (nameEl) nameEl.textContent = 'Lead: ' + leadName;
  const sel = document.getElementById('niReasonSelect');
  if (sel) sel.value = '';
  new bootstrap.Modal(document.getElementById('niModal')).show();
}

/* ===== CONTACT OUTCOME — COULD NOT CONNECT ===== */
let _coLeadId = null;

function tgShowContactOutcomeModal(leadId, leadName) {
  _coLeadId = leadId;
  const nameEl = document.getElementById('coLeadName');
  if (nameEl) nameEl.textContent = 'Lead: ' + leadName;
  new bootstrap.Modal(document.getElementById('contactOutcomeModal')).show();
}

function tgSubmitContactOutcome(outcome) {
  setVal('coLeadId', _coLeadId);
  setVal('coOutcome', outcome);
  bootstrap.Modal.getInstance(document.getElementById('contactOutcomeModal')).hide();
  document.getElementById('coForm').submit();
}

/* ============================ BOOKINGS PAGE ============================ */
function filterBookings() {
  const q = (document.getElementById('bookingSearch')?.value || '').toLowerCase();
  const st = document.getElementById('bookingStatusFilter')?.value || '';
  document.querySelectorAll('#bookingsTable tbody tr[data-search]').forEach(tr => {
    const okQ = !q || tr.dataset.search.includes(q);
    const okS = !st || tr.dataset.status === st;
    tr.style.display = (okQ && okS) ? '' : 'none';
  });
}

function tgResetBookingForm() {
  const form = document.querySelector('#bookingModal form');
  if (form) form.reset();
  const unitSel = document.getElementById('bk_unit');
  if (unitSel) unitSel.innerHTML = '<option value="">Select project first</option>';
}

async function tgLoadUnits(projectId) {
  const sel = document.getElementById('bk_unit');
  if (!sel) return;
  if (!projectId) {
    sel.innerHTML = '<option value="">Select project first</option>';
    return;
  }
  sel.innerHTML = '<option value="">Loading\u2026</option>';
  try {
    const res = await fetch('/api/units/' + projectId);
    const units = await res.json();
    if (!units.length) {
      sel.innerHTML = '<option value="">No available units</option>';
      return;
    }
    sel.innerHTML = '<option value="">Select unit</option>' + units.map(u =>
      '<option value="' + u._id + '">' + escapeHtml(u.unit_number) +
      (u.bhk ? ' \u2014 ' + escapeHtml(u.bhk) : '') +
      (u.status === 'Hold' ? ' [on hold]' : '') +
      (u.base_price ? ' (' + fmt.money(u.base_price) + ')' : '') +
      '</option>'
    ).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">Failed to load units</option>';
  }
}

function tgEditBooking(b) {
  setVal('eb_id', b._id);
  setVal('eb_sale', b.sale_value);
  setVal('eb_amount', b.booking_amount);
  setVal('eb_date', b.booking_date);
  setVal('eb_status', b.status);
  setVal('eb_notes', b.notes);
  new bootstrap.Modal(document.getElementById('editBookingModal')).show();
}

function tgPayBooking(bookingId, leadName) {
  setVal('pm_booking', bookingId);
  const title = document.getElementById('paymentModalTitle');
  if (title) title.textContent = 'Add Payment' + (leadName ? ' \u2014 ' + leadName : '');
  new bootstrap.Modal(document.getElementById('paymentModal')).show();
}

function tgExportBookingsCsv() {
  const rows = [['Booking ID', 'Lead', 'Project', 'Unit', 'Closer', 'Sale Value', 'Booking Amount', 'Paid', 'Balance', 'Status', 'Date']];
  document.querySelectorAll('#bookingsTable tbody tr[data-search]').forEach(tr => {
    if (tr.style.display === 'none') return;
    const cells = Array.from(tr.querySelectorAll('td')).slice(0, 11).map(td => '"' + td.textContent.trim().replace(/"/g, '""') + '"');
    if (cells.length) rows.push(cells);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bookings.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================ PROJECTS PAGE ============================ */
function tgResetProjectForm() {
  const form = document.querySelector('#projectModal form');
  if (form) form.reset();
  setVal('prAction', 'add_project');
  setVal('prId', '');
  tgLockUnitCounts(false);
  const title = document.getElementById('projectModalTitle');
  if (title) title.textContent = 'Add Project';
}

// A project with units gets its counts from them, so the typed fields are locked.
// Disabled inputs aren't submitted, and update_project then leaves the stored numbers alone.
function tgLockUnitCounts(locked) {
  ['pr_total', 'pr_avail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!locked;
  });
  const hint = document.getElementById('pr_units_hint');
  if (hint) hint.hidden = !locked;
}

function tgEditProject(p) {
  setVal('prAction', 'update_project');
  setVal('prId', p._id);
  setVal('pr_name', p.name);
  setVal('pr_dev', p.developer);
  setVal('pr_loc', p.location);
  setVal('pr_city', p.city);
  setVal('pr_state', p.state);
  setVal('pr_type', p.project_type);
  setVal('pr_status', p.status);
  setVal('pr_total', p.total_units);
  setVal('pr_avail', p.available_units);
  tgLockUnitCounts(p.from_units);
  setVal('pr_price', p.price_range);
  setVal('pr_notes', p.notes);
  setVal('pr_team', p.team_id);
  const title = document.getElementById('projectModalTitle');
  if (title) title.textContent = 'Edit Project';
  new bootstrap.Modal(document.getElementById('projectModal')).show();
}

function tgAddUnit(projectId) {
  const form = document.querySelector('#unitModal form');
  if (form) form.reset();
  setVal('unAction', 'add_unit');
  setVal('unId', '');
  setVal('unProjectId', projectId);
  const title = document.getElementById('unitModalTitle');
  if (title) title.textContent = 'Add Unit';
  new bootstrap.Modal(document.getElementById('unitModal')).show();
}

function tgEditUnit(u) {
  setVal('unAction', 'update_unit');
  setVal('unId', u._id);
  setVal('unProjectId', u.project_id);
  setVal('un_number', u.unit_number);
  setVal('un_type', u.type);
  setVal('un_tower', u.tower);
  setVal('un_floor', u.floor);
  setVal('un_phase', u.phase);
  setVal('un_bhk', u.bhk);
  setVal('un_area', u.area_sqft);
  setVal('un_price', u.base_price);
  setVal('un_status', u.status);
  setVal('un_notes', u.notes);
  const title = document.getElementById('unitModalTitle');
  if (title) title.textContent = 'Edit Unit';
  new bootstrap.Modal(document.getElementById('unitModal')).show();
}

/* ============================ SOURCES PAGE ============================ */
function tgResetSourceForm() {
  const form = document.querySelector('#sourceModal form');
  if (form) form.reset();
  setVal('srAction', 'add_source');
  setVal('srId', '');
  const cb = document.getElementById('sr_active');
  if (cb) cb.checked = true;
  const title = document.getElementById('sourceModalTitle');
  if (title) title.textContent = 'Add Source';
}

function tgEditSource(s) {
  setVal('srAction', 'update_source');
  setVal('srId', s._id);
  setVal('sr_name', s.name);
  setVal('sr_channel', s.channel);
  setVal('sr_notes', s.notes);
  setVal('sr_team', s.team_id);
  const cb = document.getElementById('sr_active');
  if (cb) cb.checked = !!s.active;
  const title = document.getElementById('sourceModalTitle');
  if (title) title.textContent = 'Edit Source';
  new bootstrap.Modal(document.getElementById('sourceModal')).show();
}

/* ============================ USERS PAGE ============================ */
function tgToggleTeamField() {
  const role = document.getElementById('us_role')?.value;
  const wrap = document.getElementById('us_team_wrap');
  if (!wrap) return;
  wrap.style.display = (role === 'Team Leader' || role === 'Sub Team Leader') ? '' : 'none';
}

function tgResetUserForm() {
  const form = document.querySelector('#userModal form');
  if (form) form.reset();
  setVal('usAction', 'add_user');
  setVal('usId', '');
  const pw = document.getElementById('us_password');
  if (pw) pw.required = true;
  const hint = document.getElementById('usPasswordHint');
  if (hint) hint.textContent = '(min 6 chars)';
  const title = document.getElementById('userModalTitle');
  if (title) title.textContent = 'Add User';
  tgToggleTeamField();
}

function tgEditUser(u) {
  setVal('usAction', 'update_user');
  setVal('usId', u._id);
  setVal('us_name', u.full_name);
  setVal('us_email', u.email);
  setVal('us_phone', u.phone);
  setVal('us_role', u.role);
  setVal('us_status', u.status);
  setVal('us_team', u.team_id || '');
  const pw = document.getElementById('us_password');
  if (pw) { pw.required = false; pw.value = ''; }
  const hint = document.getElementById('usPasswordHint');
  if (hint) hint.textContent = '(leave blank to keep current)';
  const title = document.getElementById('userModalTitle');
  if (title) title.textContent = 'Edit User';
  tgToggleTeamField();
  new bootstrap.Modal(document.getElementById('userModal')).show();
}

/* ===== TEAMS ===== */
function tgResetTeamForm() {
  const form = document.querySelector('#teamModal form');
  if (form) form.reset();
  setVal('tmAction', 'add_team');
  setVal('tmId', '');
  const title = document.getElementById('teamModalTitle');
  if (title) title.textContent = 'Create Team';
}

function tgEditTeam(t) {
  setVal('tmAction', 'update_team');
  setVal('tmId', t._id);
  setVal('tm_name', t.name);
  setVal('tm_leader', t.team_leader_id);
  const title = document.getElementById('teamModalTitle');
  if (title) title.textContent = 'Edit Team';
  new bootstrap.Modal(document.getElementById('teamModal')).show();
}
/* ===== SMART CSV COLUMN MAPPER ===== */

const TG_FIELD_ALIASES = {
  name:         ['name','fullname','full_name','leadname','lead_name','customername',
                 'customer_name','contactname','contact_name','clientname','client_name',
                 'full name','lead name','customer name','contact name','applicant name',
                 'prospect','sendername','sender name'],
  phone:        ['phone','mobile','phonenumber','phone_number','mobilenumber','mobile_number',
                 'contact','cell','whatsapp','contactno','mobileno','phone no','mobile no',
                 'phone number','mobile number','contact no','contact number',
                 'whatsapp number','ph','mob'],
  email:        ['email','emailid','email_id','emailaddress','email_address','mail',
                 'email id','email address','e-mail','e mail'],
  city:         ['city','location','town','area','district','region','locality',
                 'place','city name'],
  source_name:  ['source','sourcename','source_name','leadsource','lead_source',
                 'channel','medium','campaign','source name','lead source',
                 'origin','portal','platform'],
  project_name: ['project','projectname','project_name','property','propertyname',
                 'property_name','development','scheme','project name','property name',
                 'building','tower','society','development name'],
  budget_range: ['budget','budgetrange','budget_range','price','pricerange','price_range',
                 'requirement','investment','budget range','price range',
                 'expected budget','investment range','property budget'],
  notes:        ['notes','note','comments','comment','remarks','remark',
                 'description','details','info','message','additional info',
                 'other details','requirement details','query']
};

const TG_FIELD_LABELS = {
  name:         { label: 'Name',         required: true  },
  phone:        { label: 'Phone',        required: true  },
  email:        { label: 'Email',        required: false },
  city:         { label: 'City',         required: false },
  source_name:  { label: 'Lead Source',  required: false },
  project_name: { label: 'Project',      required: false },
  budget_range: { label: 'Budget Range', required: false },
  notes:        { label: 'Notes',        required: false }
};

let _csvHeaders = [];
let _csvRows    = [];
let _csvFile    = null;

function tgParseCsvLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

function tgParseCsvPreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const lines    = e.target.result.split('\n').map(l => l.replace(/\r/g, '')).filter(l => l.trim());
        if (!lines.length) return reject(new Error('File is empty'));
        const headers  = tgParseCsvLine(lines[0]);
        const rows     = lines.slice(1, 4).map(l => {
          const vals = tgParseCsvLine(l);
          const row  = {};
          headers.forEach((h, i) => { row[h] = vals[i] || ''; });
          return row;
        });
        resolve({ headers, rows });
      } catch(err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file, 'UTF-8');
  });
}

function tgAutoDetect(headers) {
  const mapping = {};
  headers.forEach(header => {
    const norm = header.toLowerCase().replace(/[\s\-_.]/g, '');
    for (const [field, aliases] of Object.entries(TG_FIELD_ALIASES)) {
      if (!mapping[field]) {
        if (aliases.some(a => a.replace(/[\s\-_.]/g, '') === norm)) {
          mapping[field] = header;
        }
      }
    }
  });
  return mapping;
}

async function tgShowColumnMapper() {
  const fileInput = document.getElementById('importFileInput');
  if (!fileInput || !fileInput.files.length) {
    alert('Please select a CSV file first.');
    return;
  }
  _csvFile = fileInput.files[0];
  try {
    const { headers, rows } = await tgParseCsvPreview(_csvFile);
    _csvHeaders = headers;
    _csvRows    = rows;

    const detected  = tgAutoDetect(headers);
    const tbody     = document.getElementById('importMapperBody');
    tbody.innerHTML = '';

    const skipOpt = '<option value="">(Skip this field)</option>';
    const colOpts = headers.map(h =>
      `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`
    ).join('');

    for (const [field, meta] of Object.entries(TG_FIELD_LABELS)) {
      const detectedCol = detected[field] || '';
      const preview     = detectedCol && rows.length ? (rows[0][detectedCol] || '') : '';
      const requiredBadge = meta.required
        ? '<span class="badge text-bg-danger ms-1" style="font-size:10px;">Required</span>'
        : '<span class="text-secondary" style="font-size:11px;"> optional</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <span class="fw-medium" style="font-size:13px;">${meta.label}</span>
          ${requiredBadge}
        </td>
        <td>
          <select class="form-select form-select-sm" id="map_${field}" data-field="${field}">
            ${skipOpt}${colOpts}
          </select>
        </td>
        <td style="font-size:12px; color:#6b7280; max-width:160px;
                   overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
            id="preview_${field}" title="${escapeHtml(preview)}">
          ${preview ? escapeHtml(preview) : '<span class="text-muted">—</span>'}
        </td>
      `;
      tbody.appendChild(tr);

      const sel = document.getElementById('map_' + field);
      if (detectedCol) sel.value = detectedCol;

      sel.addEventListener('change', () => {
        const col  = sel.value;
        const prev = document.getElementById('preview_' + field);
        const val  = col && rows.length ? (rows[0][col] || '') : '';
        prev.textContent = val || '—';
        prev.title = val;
      });
    }

    // Auto-detect summary
    const detected_count = Object.values(detected).filter(Boolean).length;
    document.getElementById('importFileLabel').textContent =
      _csvFile.name + ' · ' + headers.length + ' columns · ' +
      detected_count + '/' + Object.keys(TG_FIELD_LABELS).length + ' auto-detected';

    document.getElementById('importStep1').style.display = 'none';
    document.getElementById('importStep2').style.display = '';
  } catch(err) {
    alert('Could not read CSV: ' + err.message + '\n\nPlease make sure it is a valid CSV file.');
  }
}

function tgBackToStep1() {
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importStep1').style.display = '';
}

function tgPrepareImport() {
  const mapping = {};
  let valid     = true;

  for (const [field, meta] of Object.entries(TG_FIELD_LABELS)) {
    const sel = document.getElementById('map_' + field);
    if (!sel) continue;
    if (sel.value) {
      mapping[field] = sel.value;
      sel.classList.remove('is-invalid');
    } else if (meta.required) {
      sel.classList.add('is-invalid');
      valid = false;
    }
  }

  if (!valid) {
    alert('Name and Phone columns are required. Please map them before importing.');
    return false;
  }

  document.getElementById('importMappingJson').value = JSON.stringify(mapping);

  // Transfer the file object to the hidden file input
  try {
    const dt = new DataTransfer();
    dt.items.add(_csvFile);
    document.getElementById('importHiddenFile').files = dt.files;
  } catch(e) {
    console.warn('DataTransfer not supported in this browser:', e.message);
  }

  return true;
}

// Reset modal fully when closed
document.addEventListener('DOMContentLoaded', () => {
  const importModal = document.getElementById('importCsvModal');
  if (importModal) {
    importModal.addEventListener('hidden.bs.modal', () => {
      document.getElementById('importStep1').style.display = '';
      document.getElementById('importStep2').style.display = 'none';
      const fi = document.getElementById('importFileInput');
      if (fi) fi.value = '';
      _csvFile = null;
      _csvHeaders = [];
      _csvRows = [];
    });
  }
});

/* ===== KANBAN ===== */
let _dragCard = null;

function tgSetView(view) {
  const tableView  = document.getElementById('tgTableView');
  const kanbanView = document.getElementById('tgKanbanView');
  const tableBtn   = document.getElementById('tgViewTable');
  const kanbanBtn  = document.getElementById('tgViewKanban');
  if (!tableView || !kanbanView) return;

  if (view === 'kanban') {
    tableView.style.display  = 'none';
    kanbanView.style.display = '';
    tableBtn.className  = 'btn btn-sm btn-outline-secondary';
    kanbanBtn.className = 'btn btn-sm btn-primary';
  } else {
    tableView.style.display  = '';
    kanbanView.style.display = 'none';
    tableBtn.className  = 'btn btn-sm btn-primary';
    kanbanBtn.className = 'btn btn-sm btn-outline-secondary';
  }
  try { localStorage.setItem('tgLeadView', view); } catch(e) {}
}

function tgKanbanDragStart(event) {
  _dragCard = event.currentTarget;
  _dragCard.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
}

function tgKanbanDrop(event, colEl, newStatus) {
  event.preventDefault();
  colEl.classList.remove('drag-over');
  if (!_dragCard) return;

  const leadId    = _dragCard.dataset.id;
  const oldStatus = _dragCard.dataset.status;
  if (oldStatus === newStatus) {
    _dragCard.classList.remove('dragging');
    _dragCard = null;
    return;
  }

  // Optimistic UI — move card instantly, sync to server in background
  _dragCard.dataset.status = newStatus;
  colEl.appendChild(_dragCard);
  _dragCard.classList.remove('dragging');
  tgUpdateKanbanCounts();
  _dragCard = null;

  fetch(`/api/lead/${leadId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  }).then(r => r.json()).then(d => {
    if (!d.ok) { if (d.error) alert(d.error); location.reload(); }
  }).catch(() => location.reload());
}

function tgUpdateKanbanCounts() {
  document.querySelectorAll('.tg-kanban-col').forEach(col => {
    const id    = 'kcount_' + col.dataset.status.replace(/ /g, '_');
    const badge = document.getElementById(id);
    if (badge) {
      badge.textContent = col.querySelectorAll(
        '.tg-kanban-card:not([style*="display: none"])'
      ).length;
    }
  });
}
// ============ CHATBOT ============
// ============ CHATBOT ============
let tgChatOpen = false;
let _completeFuId = null;

function tgToggleChat() {
  tgChatOpen = !tgChatOpen;
  const win = document.getElementById('tgChatWindow');
  const btn = document.getElementById('tgChatBtn');
  win.style.display = tgChatOpen ? 'flex' : 'none';
  btn.innerHTML = tgChatOpen
    ? '<i class="fa-solid fa-xmark"></i>'
    : '<i class="fa-solid fa-robot"></i>';
  if (tgChatOpen) {
    document.getElementById('tgChatInput').focus();
    sessionStorage.setItem('tgChatOpen', '1');
  } else {
    sessionStorage.removeItem('tgChatOpen');
  }
}

function tgAppendMsg(text, type, persist) {
  const box = document.getElementById('tgChatMessages');
  const div = document.createElement('div');
  div.className = type === 'user' ? 'tg-msg-user' : 'tg-msg-bot';
  // Escape first so lead names / AI output render as text, then apply the
  // two bits of formatting the bot uses (**bold** and line breaks).
  div.innerHTML = escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;

  // Save to sessionStorage so messages survive page navigation
  if (persist !== false) {
    try {
      const history = JSON.parse(sessionStorage.getItem('tgHistory') || '[]');
      history.push({ text, type });
      if (history.length > 30) history.splice(0, history.length - 30);
      sessionStorage.setItem('tgHistory', JSON.stringify(history));
    } catch(e) {}
  }
  return div;
}

async function tgSendChat() {
  const input = document.getElementById('tgChatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';

  tgAppendMsg(message, 'user');

  const box = document.getElementById('tgChatMessages');
  const typing = document.createElement('div');
  typing.className = 'tg-msg-typing';
  typing.textContent = '•••';
  box.appendChild(typing);
  box.scrollTop = 999999;

  try {
    let history = [];
    try { history = JSON.parse(sessionStorage.getItem('tgHistory') || '[]').slice(-10); } catch(e) {}
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history })
    });
    const data = await res.json();
    typing.remove();
    tgAppendMsg(data.reply || 'No response.', 'bot');
  } catch (e) {
    typing.remove();
    tgAppendMsg('Connection error. Try again.', 'bot');
  }
}

// Restore chat state after page navigation
document.addEventListener('DOMContentLoaded', () => {
  // Restore kanban/table preference
  try {
    if (localStorage.getItem('tgLeadView') === 'kanban') tgSetView('kanban');
  } catch(e) {}

  // Not Interested confirm button
  const confirmNiBtn = document.getElementById('confirmNiBtn');
  if (confirmNiBtn) {
    confirmNiBtn.addEventListener('click', () => {
      const reason = document.getElementById('niReasonSelect').value;
      setVal('niLeadId', _niLeadId);
      setVal('niReason', reason);
      bootstrap.Modal.getInstance(document.getElementById('niModal')).hide();
      document.getElementById('niForm').submit();
    });
  }

  // Restore open/closed state
  if (sessionStorage.getItem('tgChatOpen') === '1') {
    const win = document.getElementById('tgChatWindow');
    const btn = document.getElementById('tgChatBtn');
    if (win && btn) {
      tgChatOpen = true;
      win.style.display = 'flex';
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    }
  }

  // Restore message history
  try {
    const history = JSON.parse(sessionStorage.getItem('tgHistory') || '[]');
    // Clear the default welcome message if we have history
    if (history.length > 0) {
      const box = document.getElementById('tgChatMessages');
      if (box) box.innerHTML = '';
    }
    history.forEach(msg => tgAppendMsg(msg.text, msg.type, false));
  } catch(e) {}

});