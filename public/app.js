// TrueGrowth CRM — client-side JS
// Charts, filters, timeline offcanvas, dynamic unit loading, CSV helpers, modal edit forms.

const fmt = {
  money: n => '\u20B9' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
};

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val == null ? '' : val;
}

/* ============================ DASHBOARD CHARTS ============================ */
document.addEventListener('DOMContentLoaded', () => {
  const trend = document.getElementById('trendChart');
  if (trend && window.Chart) {
    const labels = JSON.parse(trend.dataset.labels || '[]');
    const values = JSON.parse(trend.dataset.values || '[]');
    new Chart(trend, {
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
          y: { ticks: { callback: v => fmt.money(v) }, grid: { color: '#f1f5f9' } },
          x: { grid: { display: false } }
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
    new Chart(status, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: labels.map(l => palette[l] || '#9ca3af'), borderWidth: 2 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }
      }
    });
  }

  // Leads filters
  ['leadSearch', 'leadStatusFilter', 'leadSourceFilter', 'leadProjectFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', filterLeads);
  });

  // Bookings filters
  ['bookingSearch', 'bookingStatusFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', filterBookings);
  });

  const confirmCompleteBtn = document.getElementById('confirmCompleteBtn');
  if (confirmCompleteBtn) {
    confirmCompleteBtn.addEventListener('click', () => {
      const outcome = document.getElementById('completeOutcomeInput').value;
      setVal('completeFuId', _completeFuId);
      setVal('completeFuOutcome', outcome);
      bootstrap.Modal.getInstance(document.getElementById('completeModal')).hide();
      document.getElementById('completeFuForm').submit();
    });
  }
});

/* ============================ LEADS PAGE ============================ */
function filterLeads() {
  const q = (document.getElementById('leadSearch')?.value || '').toLowerCase();
  const st = document.getElementById('leadStatusFilter')?.value || '';
  const src = document.getElementById('leadSourceFilter')?.value || '';
  const prj = document.getElementById('leadProjectFilter')?.value || '';
  document.querySelectorAll('#leadsTable tbody tr[data-search]').forEach(tr => {
    const okQ = !q || tr.dataset.search.includes(q);
    const okS = !st || tr.dataset.status === st;
    const okSrc = !src || tr.dataset.source === src;
    const okP = !prj || tr.dataset.project === prj;
    tr.style.display = (okQ && okS && okSrc && okP) ? '' : 'none';
  });
}

function tgResetLeadForm() {
  const form = document.querySelector('#leadModal form');
  if (form) form.reset();
  setVal('leadAction', 'add_lead');
  setVal('leadId', '');
  const title = document.getElementById('leadModalTitle');
  if (title) title.textContent = 'Add Lead';
}

function tgEditLead(lead) {
  setVal('leadAction', 'update_lead');
  setVal('leadId', lead._id);
  setVal('lf_name', lead.name);
  setVal('lf_phone', lead.phone);
  setVal('lf_email', lead.email);
  setVal('lf_city', lead.city);
  setVal('lf_source', lead.source_id);
  setVal('lf_project', lead.project_id);
  setVal('lf_budget', lead.budget_range);
  setVal('lf_status', lead.status);
  setVal('lf_caller', lead.assigned_caller_id);
  setVal('lf_closer', lead.assigned_closer_id);
  setVal('lf_notes', lead.notes);
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

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s == null ? '' : s);
  return div.innerHTML;
}

/* ============================ CSV IMPORT ============================ */
function tgDownloadSampleCsv() {
  const csv = 'name,phone,email,city,source_name,project_name,budget_range,notes\n' +
    'Rahul Sharma,9876543210,rahul@example.com,Mumbai,Website,Sky Heights,80L - 1Cr,Interested in 3BHK\n' +
    'Priya Patel,9123456780,priya@example.com,Pune,Referral,,50L - 70L,Referred by existing customer';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'truegrowth-leads-template.csv';
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

let _completeFuId = null;

function tgCompleteFollowup(id) {
  _completeFuId = id;
  document.getElementById('completeOutcomeInput').value = '';
  new bootstrap.Modal(document.getElementById('completeModal')).show();
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
  a.download = 'truegrowth-bookings.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================ PROJECTS PAGE ============================ */
function tgResetProjectForm() {
  const form = document.querySelector('#projectModal form');
  if (form) form.reset();
  setVal('prAction', 'add_project');
  setVal('prId', '');
  const title = document.getElementById('projectModalTitle');
  if (title) title.textContent = 'Add Project';
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
  setVal('pr_price', p.price_range);
  setVal('pr_notes', p.notes);
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
  const cb = document.getElementById('sr_active');
  if (cb) cb.checked = !!s.active;
  const title = document.getElementById('sourceModalTitle');
  if (title) title.textContent = 'Edit Source';
  new bootstrap.Modal(document.getElementById('sourceModal')).show();
}

/* ============================ USERS PAGE ============================ */
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
}

function tgEditUser(u) {
  setVal('usAction', 'update_user');
  setVal('usId', u._id);
  setVal('us_name', u.full_name);
  setVal('us_email', u.email);
  setVal('us_phone', u.phone);
  setVal('us_role', u.role);
  setVal('us_status', u.status);
  const pw = document.getElementById('us_password');
  if (pw) { pw.required = false; pw.value = ''; }
  const hint = document.getElementById('usPasswordHint');
  if (hint) hint.textContent = '(leave blank to keep current)';
  const title = document.getElementById('userModalTitle');
  if (title) title.textContent = 'Edit User';
  new bootstrap.Modal(document.getElementById('userModal')).show();
}
