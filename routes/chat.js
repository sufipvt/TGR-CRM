// AI chatbot API
const express = require('express');
const { Project, Lead, FollowUp, Booking } = require('../models');
const { isAdminRole, isTeamLeader } = require('../utils/roles');
const { escapeRegex } = require('../utils/request');
const { visibleLeadFilter, visibleFollowUpFilter, visibleBookingFilter } = require('../services/access');
const { requireAuth, refreshUserContext } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimits');
const { getSettings, APP_NAME } = require('../services/settings');

const router = express.Router();

// ============ CHATBOT ROUTE ============
router.post('/api/chat', requireAuth, chatLimiter, refreshUserContext, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string') return res.json({ reply: 'Please type a message.' });
    const user = req.user;

    // Every answer is limited to what this user may see elsewhere in the CRM:
    // admins see the company, Team Leaders their team, everyone else their own work.
    const [leadFilter, fuFilter, bookingFilter] = await Promise.all([
      visibleLeadFilter(user), visibleFollowUpFilter(user), visibleBookingFilter(user)
    ]);
    const scopeLabel = isAdminRole(user.role) ? 'the whole company' : isTeamLeader(user.role) ? 'their team' : 'their own leads';
    const matchStage = f => (Object.keys(f).length ? [{ $match: f }] : []);

    const cmd = message.trim().toLowerCase();

    if (cmd === '/leads' || cmd === 'my leads') {
      const leads = await Lead.find(leadFilter).sort('-created_at').limit(5).populate('project_id source_id');
      if (!leads.length) return res.json({ reply: 'No leads found.' });
      const list = leads.map(l =>
        `• **${l.name}** — ${l.phone} — ${l.status} — ${l.project_id?.name || '—'}`
      ).join('\n');
      return res.json({ reply: `Your recent leads:\n${list}` });
    }

    if (cmd === '/overdue') {
      const fus = await FollowUp.find({ ...fuFilter, status: 'Pending', scheduled_date: { $lt: new Date() } }).populate('lead_id').limit(5);
      if (!fus.length) return res.json({ reply: '✅ No overdue follow-ups!' });
      const list = fus.map(f =>
        `• **${f.lead_id?.name || '—'}** — ${f.type} — Due: ${new Date(f.scheduled_date).toLocaleDateString('en-IN')}`
      ).join('\n');
      return res.json({ reply: `Overdue follow-ups:\n${list}` });
    }

    if (cmd === '/today') {
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
      const fus = await FollowUp.find({ ...fuFilter, status: 'Pending', scheduled_date: { $gte: todayStart, $lte: todayEnd } }).populate('lead_id').sort('scheduled_date');
      if (!fus.length) return res.json({ reply: '✅ No follow-ups scheduled for today!' });
      const list = fus.map(f =>
        `• **${f.lead_id?.name || '—'}** — ${f.type} at ${new Date(f.scheduled_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
      ).join('\n');
      return res.json({ reply: `📅 **Today's Follow-Ups (${fus.length}):**\n${list}` });
    }

    if (cmd === '/stats') {
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const [totalLeads, newToday, pendingFU, overdueFU] = await Promise.all([
        Lead.countDocuments(leadFilter),
        Lead.countDocuments({ ...leadFilter, created_at: { $gte: todayStart } }),
        FollowUp.countDocuments({ ...fuFilter, status: 'Pending' }),
        FollowUp.countDocuments({ ...fuFilter, status: 'Pending', scheduled_date: { $lt: new Date() } })
      ]);
      return res.json({ reply:
        `📊 **Your Stats**\n` +
        `• Total Leads: ${totalLeads}\n` +
        `• New Today: ${newToday}\n` +
        `• Pending Follow-Ups: ${pendingFU}\n` +
        `• Overdue: ${overdueFU}`
      });
    }

    if (cmd === '/bookings') {
      const bookings = await Booking.find(bookingFilter).sort('-booking_date').limit(5).populate('lead_id project_id');
      if (!bookings.length) return res.json({ reply: 'No bookings found.' });
      const list = bookings.map(b =>
        `• **${b.lead_id?.name || '—'}** — ${b.project_id?.name || '—'} — ₹${Number(b.sale_value).toLocaleString('en-IN')}`
      ).join('\n');
      return res.json({ reply: `Recent bookings:\n${list}` });
    }

    if (cmd === '/revenue') {
      const agg = await Booking.aggregate([
        ...matchStage(bookingFilter),
        { $group: { _id: null, total: { $sum: '$sale_value' }, count: { $sum: 1 } } }
      ]);
      const total = agg[0]?.total || 0;
      const count = agg[0]?.count || 0;
      return res.json({ reply:
        `💰 **Revenue Summary**\n` +
        `• Total Revenue: ₹${total.toLocaleString('en-IN')}\n` +
        `• Total Bookings: ${count}\n` +
        `• Avg per Booking: ₹${count ? Math.round(total / count).toLocaleString('en-IN') : 0}`
      });
    }

    if (cmd === '/pipeline') {
      const statuses = ['New','Working','Qualified','Site Visit Scheduled','Negotiation'];
      const counts = await Promise.all(statuses.map(s => Lead.countDocuments({ ...leadFilter, status: s })));
      const list = statuses.map((s, i) => `• ${s}: ${counts[i]}`).join('\n');
      return res.json({ reply: `🔄 **Pipeline Status:**\n${list}` });
    }

    if (cmd.startsWith('/search ')) {
      const q = message.trim().slice('/search '.length).trim();
      if (!q) return res.json({ reply: 'Type a name after /search.' });
      const leads = await Lead.find({ ...leadFilter, name: { $regex: escapeRegex(q), $options: 'i' } }).limit(5).populate('project_id');
      if (!leads.length) return res.json({ reply: `No leads found for "${q}".` });
      const list = leads.map(l =>
        `• **${l.name}** — ${l.phone} — ${l.status} — ${l.project_id?.name || '—'}`
      ).join('\n');
      return res.json({ reply: `Search results for "${q}":\n${list}` });
    }

    if (cmd === '/help') {
      return res.json({ reply:
        `**Quick Commands:**\n` +
        `/leads — your recent leads\n` +
        `/overdue — overdue follow-ups\n` +
        `/today — today's follow-ups\n` +
        `/stats — your performance stats\n` +
        `/bookings — recent bookings\n` +
        `/revenue — revenue summary\n` +
        `/pipeline — lead pipeline status\n` +
        `/search [name] — find a lead\n` +
        `/help — show this list\n\n` +
        `Or ask anything in plain English!`
      });
    }

    // --- AI (GROQ) for natural language ---
    if (!process.env.GROQ_API_KEY) {
      return res.json({ reply: 'AI not configured. Use /help for commands.' });
    }

    // Context for the model, computed with the same visibility filters as above,
    // so the model is never handed numbers the user isn't allowed to see.
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const [
      totalLeads, newToday, totalBookings, projectsList, pendingFUs, overdueFUs, revenueAgg, byStatus, topSources
    ] = await Promise.all([
      Lead.countDocuments(leadFilter),
      Lead.countDocuments({ ...leadFilter, created_at: { $gte: todayStart } }),
      Booking.countDocuments(bookingFilter),
      Project.find().select('name status city price_range total_units available_units project_type notes').lean(),
      FollowUp.countDocuments({ ...fuFilter, status: 'Pending' }),
      FollowUp.countDocuments({ ...fuFilter, status: 'Pending', scheduled_date: { $lt: new Date() } }),
      Booking.aggregate([...matchStage(bookingFilter), { $group: { _id: null, total: { $sum: '$sale_value' } } }]),
      Lead.aggregate([...matchStage(leadFilter), { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Lead.aggregate([
        ...matchStage(leadFilter),
        { $group: { _id: '$source_id', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 3 },
        { $lookup: { from: 'leadsources', localField: '_id', foreignField: '_id', as: 'src' } }
      ])
    ]);
    const settings = await getSettings();
    const projectSummary = projectsList.map(p =>
      `  - ${p.name} | Type: ${p.project_type || '—'} | City: ${p.city || '—'} | Status: ${p.status} | Price: ${p.price_range || '—'} | Units: ${p.available_units}/${p.total_units} available | Notes: ${p.notes || '—'}`
    ).join('\n');
    const totalRevenue = revenueAgg[0]?.total || 0;
    const statusSummary = byStatus.map(s => `${s._id}: ${s.count}`).join(', ');
    const sourceSummary = topSources.map(s => `${s.src[0]?.name || '—'}: ${s.count}`).join(', ');

    const systemPrompt =
      `You are the AI assistant inside ${APP_NAME}, the real estate sales CRM of ${settings.company_name}, used in India.\n` +
      `You only answer questions about CRM data. Be concise, helpful, and use Indian context (₹ for currency).\n` +
      `Logged in user: ${user.name} (${user.role}). The lead, follow-up and booking numbers below cover ${scopeLabel}.\n` +
      `CRM Data:\n` +
      `- Total Leads: ${totalLeads} (${newToday} new today)\n` +
      `- Lead Status Breakdown: ${statusSummary}\n` +
      `- Total Bookings: ${totalBookings}\n` +
      `- Total Revenue: ₹${totalRevenue.toLocaleString('en-IN')}\n` +
      `- Pending Follow-Ups: ${pendingFUs} (${overdueFUs} overdue)\n` +
      `- Projects (company inventory, ${projectsList.length}):\n${projectSummary}\n` +
      `- Top Lead Sources: ${sourceSummary}\n` +
      'Answer only based on this data. If asked something outside CRM scope, politely decline.';

    // Multi-turn conversation memory — last 8 exchanges sent to Groq
    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...Array.isArray(history) ? history.slice(-8).map(h => ({
        role: h && h.type === 'user' ? 'user' : 'assistant',
        content: String((h && h.text) || '').replace(/<[^>]+>/g, '').trim()
      })).filter(m => m.content) : [],
      { role: 'user', content: message }
    ];

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        max_tokens: 300,
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(20000) // never hold the request open on a hung provider
    });

    if (!groqRes.ok) {
      console.error('Groq error:', groqRes.status, (await groqRes.text()).slice(0, 300));
      return res.json({ reply: 'The assistant is unavailable right now. Use /help for quick commands.' });
    }
    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content || 'Sorry, I could not process that.';
    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err);
    res.json({ reply: 'Something went wrong. Try again.' });
  }
});

module.exports = router;
