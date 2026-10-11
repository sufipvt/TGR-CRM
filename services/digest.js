// Daily follow-up email digest (sent via SendGrid, scheduled from server.js)
const sgMail = require('@sendgrid/mail');
const { User, FollowUp, Lead } = require('../models');
const { APP_NAME } = require('./settings');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  sgMail.setTimeout(15000); // one slow send must not stall the whole digest run
}

// Lead names, phones and notes are user data: escape them before they go into email HTML.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function digestKpiBox(label, count, color) {
  return '<td style="padding:6px;"><div style="background:' + color + ';border-radius:10px;padding:14px 8px;text-align:center;color:#ffffff;">' +
    '<div style="font-size:26px;font-weight:700;">' + count + '</div>' +
    '<div style="font-size:12px;opacity:0.9;">' + label + '</div></div></td>';
}

function followupCard(f) {
  const lead = f.lead_id || {};
  const when = new Date(f.scheduled_date).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return '<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px;">' +
    '<div style="font-weight:600;color:#111827;">' + esc(lead.name || 'Lead') + ' <span style="color:#6b7280;font-weight:400;">' + esc(lead.phone || '') + '</span></div>' +
    '<div style="font-size:13px;color:#374151;margin-top:4px;">' +
    '<span style="background:#1a56db;color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;">' + f.type + '</span> ' +
    '<span style="color:#6b7280;">' + when + '</span></div>' +
    (f.notes ? '<div style="font-size:12px;color:#6b7280;margin-top:4px;">' + esc(f.notes) + '</div>' : '') +
    '</div>';
}

function digestHtml(title, dateStr, kpis, sections) {
  return '<div style="background:#f4f7fe;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">' +
    '<div style="background:#082f49;padding:22px 24px;color:#ffffff;">' +
    '<div style="font-size:18px;font-weight:700;">' + APP_NAME + '</div>' +
    '<div style="font-size:13px;opacity:0.8;margin-top:2px;">' + title + ' \u2014 ' + dateStr + '</div></div>' +
    '<div style="padding:18px 18px 8px;"><table width="100%" cellpadding="0" cellspacing="0"><tr>' + kpis + '</tr></table></div>' +
    '<div style="padding:8px 24px 8px;">' + sections + '</div>' +
    '<div style="padding:8px 24px 20px;text-align:center;">' +
    '<a href="' + (process.env.APP_URL || '#') + '" style="display:inline-block;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:8px;padding:11px 26px;font-weight:600;font-size:14px;">Open CRM</a></div>' +
    '<div style="padding:14px 24px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;">You are receiving this because you have an active ' + APP_NAME + ' account. Manage notification preferences in the CRM.</div>' +
    '</div></div>';
}

async function sendDailyDigest() {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('WARN: SendGrid not configured, skipping email digest');
    return;
  }
  try {
    const users = await User.find({ status: 'Active' });
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    let sent = 0, skipped = 0;
    const teamStats = [];

    for (const u of users.filter(x => x.role === 'Sub Team Leader')) {
      const fus = await FollowUp.find({ assigned_to_id: u._id, status: 'Pending' }).populate({ path: 'lead_id', select: 'name phone' }).sort('scheduled_date');
      const overdue = fus.filter(f => f.scheduled_date < startOfToday);
      const today = fus.filter(f => f.scheduled_date >= startOfToday && f.scheduled_date <= endOfToday);
      const upcoming = fus.filter(f => f.scheduled_date > endOfToday);
      teamStats.push({ name: u.full_name, role: u.role, overdue: overdue.length, today: today.length, upcoming: upcoming.length });
      if (overdue.length + today.length === 0) { skipped++; continue; }

      const kpis = digestKpiBox('Overdue', overdue.length, overdue.length > 0 ? '#dc2626' : '#6b7280') +
        digestKpiBox('Today', today.length, '#1a56db') +
        digestKpiBox('Upcoming', upcoming.length, '#059669');

      let sections = '';
      if (overdue.length) sections += '<h3 style="font-size:14px;color:#dc2626;margin:14px 0 8px;">Overdue</h3>' + overdue.slice(0, 10).map(followupCard).join('');
      if (today.length) sections += '<h3 style="font-size:14px;color:#1a56db;margin:14px 0 8px;">Today</h3>' + today.slice(0, 10).map(followupCard).join('');

      try {
        await sgMail.send({
          to: u.email,
          from: process.env.SENDGRID_FROM,
          subject: 'Your follow-ups for ' + dateStr + ' \u2014 ' + (overdue.length + today.length) + ' need attention',
          html: digestHtml('Daily Follow-Up Digest', dateStr, kpis, sections)
        });
        sent++;
      } catch (e) { console.error('Digest send failed for ' + u.email + ':', e.message); }
    }

    // MD/Admin summary
    const newToday = await Lead.countDocuments({ created_at: { $gte: startOfToday } });
    const totalOverdue = teamStats.reduce((s, t) => s + t.overdue, 0);
    for (const m of users.filter(x => ['Super Admin', 'Admin', 'Team Leader'].includes(x.role))) {
      const kpis = digestKpiBox('Team Overdue', totalOverdue, totalOverdue > 0 ? '#dc2626' : '#6b7280') +
        digestKpiBox('New Leads Today', newToday, '#1a56db') +
        digestKpiBox('Active Agents', teamStats.length, '#059669');
      const rows = teamStats.map(t =>
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;">' + esc(t.name) + ' <span style="color:#6b7280;">(' + esc(t.role) + ')</span></td>' +
        '<td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:' + (t.overdue > 0 ? '#dc2626' : '#111827') + ';">' + t.overdue + '</td>' +
        '<td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">' + t.today + '</td>' +
        '<td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">' + t.upcoming + '</td></tr>'
      ).join('');
      const sections = '<h3 style="font-size:14px;color:#111827;margin:14px 0 8px;">Team Follow-Up Summary</h3>' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;">' +
        '<tr style="background:#f8fafc;"><th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;">Agent</th><th style="padding:8px;font-size:12px;color:#6b7280;">Overdue</th><th style="padding:8px;font-size:12px;color:#6b7280;">Today</th><th style="padding:8px;font-size:12px;color:#6b7280;">Upcoming</th></tr>' +
        rows + '</table>';
      try {
        await sgMail.send({
          to: m.email,
          from: process.env.SENDGRID_FROM,
          subject: 'MD Summary \u2014 ' + dateStr + ' \u2014 ' + newToday + ' new leads, ' + totalOverdue + ' overdue',
          html: digestHtml('MD Team Summary', dateStr, kpis, sections)
        });
        sent++;
      } catch (e) { console.error('MD digest send failed for ' + m.email + ':', e.message); }
    }

    console.log('Digest sent: ' + sent + ' users, ' + skipped + ' skipped');
  } catch (e) {
    console.error('Digest failed:', e.message);
  }
}

module.exports = { sendDailyDigest };
