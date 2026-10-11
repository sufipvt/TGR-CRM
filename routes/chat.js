// AI chatbot API
const express = require('express');
const { User, Project, Lead, FollowUp, Booking } = require('../models');
const { isAdminOrMD } = require('../utils/roles');
const { requireAuth, refreshUserContext } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimits');

const router = express.Router();

// ============ CHATBOT ROUTE ============
router.post('/api/chat', requireAuth, chatLimiter, refreshUserContext, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const user = await User.findById(req.user.userId);
    if (!message) return res.json({ reply: 'Please type a message.' });

    const cmd = message.trim().toLowerCase();

    if (cmd === '/leads' || cmd === 'my leads') {
      const filter = isAdminOrMD(user)
        ? {}
        : { $or: [{ assigned_caller_id: user._id }, { assigned_closer_id: user._id }] };
      const leads = await Lead.find(filter).sort('-created_at').limit(5).populate('project_id source_id');
      if (!leads.length) return res.json({ reply: 'No leads found.' });
      const list = leads.map(l =>
        `• **${l.name}** — ${l.phone} — ${l.status} — ${l.project_id?.name || '—'}`
      ).join('\n');
      return res.json({ reply: `Your recent leads:\n${list}` });
    }

    if (cmd === '/overdue') {
      const filter = isAdminOrMD(user)
        ? { status: 'Pending', scheduled_date: { $lt: new Date() } }
        : { assigned_to_id: user._id, status: 'Pending', scheduled_date: { $lt: new Date() } };
      const fus = await FollowUp.find(filter).populate('lead_id').limit(5);
      if (!fus.length) return res.json({ reply: '✅ No overdue follow-ups!' });
      const list = fus.map(f =>
        `• **${f.lead_id?.name || '—'}** — ${f.type} — Due: ${new Date(f.scheduled_date).toLocaleDateString('en-IN')}`
      ).join('\n');
      return res.json({ reply: `Overdue follow-ups:\n${list}` });
    }

    if (cmd === '/today') {
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
      const filter = isAdminOrMD(user)
        ? { status: 'Pending', scheduled_date: { $gte: todayStart, $lte: todayEnd } }
        : { assigned_to_id: user._id, status: 'Pending', scheduled_date: { $gte: todayStart, $lte: todayEnd } };
      const fus = await FollowUp.find(filter).populate('lead_id').sort('scheduled_date');
      if (!fus.length) return res.json({ reply: '✅ No follow-ups scheduled for today!' });
      const list = fus.map(f =>
        `• **${f.lead_id?.name || '—'}** — ${f.type} at ${new Date(f.scheduled_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
      ).join('\n');
      return res.json({ reply: `📅 **Today's Follow-Ups (${fus.length}):**\n${list}` });
    }

    if (cmd === '/stats') {
      const filter = isAdminOrMD(user)
        ? {}
        : { $or: [{ assigned_caller_id: user._id }, { assigned_closer_id: user._id }] };
      const totalLeads = await Lead.countDocuments(filter);
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const newToday   = await Lead.countDocuments({ ...filter, created_at: { $gte: todayStart } });
      const pendingFU  = await FollowUp.countDocuments({ assigned_to_id: user._id, status: 'Pending' });
      const overdueFU  = await FollowUp.countDocuments({ assigned_to_id: user._id, status: 'Pending', scheduled_date: { $lt: new Date() } });
      return res.json({ reply:
        `📊 **Your Stats**\n` +
        `• Total Leads: ${totalLeads}\n` +
        `• New Today: ${newToday}\n` +
        `• Pending Follow-Ups: ${pendingFU}\n` +
        `• Overdue: ${overdueFU}`
      });
    }

    if (cmd === '/bookings') {
      const filter = isAdminOrMD(user) ? {} : { closer_id: user._id };
      const bookings = await Booking.find(filter).sort('-booking_date').limit(5).populate('lead_id project_id');
      if (!bookings.length) return res.json({ reply: 'No bookings found.' });
      const list = bookings.map(b =>
        `• **${b.lead_id?.name || '—'}** — ${b.project_id?.name || '—'} — ₹${Number(b.sale_value).toLocaleString('en-IN')}`
      ).join('\n');
      return res.json({ reply: `Recent bookings:\n${list}` });
    }

    if (cmd === '/revenue') {
      const filter = isAdminOrMD(user) ? {} : { closer_id: user._id };
      const agg = await Booking.aggregate([
        ...(Object.keys(filter).length ? [{ $match: filter }] : []),
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
      const baseFilter = isAdminOrMD(user)
        ? {}
        : { $or: [{ assigned_caller_id: user._id }, { assigned_closer_id: user._id }] };
      const statuses = ['New','Working','Qualified','Site Visit Scheduled','Negotiation'];
      const counts = await Promise.all(statuses.map(s => Lead.countDocuments({ ...baseFilter, status: s })));
      const list = statuses.map((s, i) => `• ${s}: ${counts[i]}`).join('\n');
      return res.json({ reply: `🔄 **Pipeline Status:**\n${list}` });
    }

    if (cmd.startsWith('/search ')) {
      const q = cmd.replace('/search ', '').trim();
      const leads = await Lead.find({ name: { $regex: q, $options: 'i' } }).limit(5).populate('project_id');
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

    // Global CRM context
    const totalLeads    = await Lead.countDocuments();
    const totalBookings = await Booking.countDocuments();
    const totalProjects = await Project.countDocuments();
    const projectsList  = await Project.find()
      .select('name status city price_range total_units available_units project_type notes').lean();
    const projectSummary = projectsList.map(p =>
      `  - ${p.name} | Type: ${p.project_type || '—'} | City: ${p.city || '—'} | Status: ${p.status} | Price: ${p.price_range || '—'} | Units: ${p.available_units}/${p.total_units} available | Notes: ${p.notes || '—'}`
    ).join('\n');
    const pendingFUs   = await FollowUp.countDocuments({ status: 'Pending' });
    const overdueFUs   = await FollowUp.countDocuments({ status: 'Pending', scheduled_date: { $lt: new Date() } });
    const revenueAgg   = await Booking.aggregate([{ $group: { _id: null, total: { $sum: '$sale_value' } } }]);
    const totalRevenue = revenueAgg[0]?.total || 0;
    const todayStart   = new Date(); todayStart.setHours(0,0,0,0);
    const newToday     = await Lead.countDocuments({ created_at: { $gte: todayStart } });
    const byStatus     = await Lead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const statusSummary = byStatus.map(s => `${s._id}: ${s.count}`).join(', ');
    const topSources   = await Lead.aggregate([
      { $group: { _id: '$source_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 3 },
      { $lookup: { from: 'leadsources', localField: '_id', foreignField: '_id', as: 'src' } }
    ]);
    const sourceSummary = topSources.map(s => `${s.src[0]?.name || '—'}: ${s.count}`).join(', ');

    // Role-aware personal section — non-managers only see their own data
    let personalSection = '';
    if (!isAdminOrMD(user)) {
      const myFilter   = user.role === 'Caller'
        ? { assigned_caller_id: user._id }
        : { assigned_closer_id: user._id };
      const myLeads    = await Lead.countDocuments(myFilter);
      const myNewToday = await Lead.countDocuments({ ...myFilter, created_at: { $gte: todayStart } });
      const myFUs      = await FollowUp.countDocuments({ assigned_to_id: user._id, status: 'Pending' });
      const myOverdue  = await FollowUp.countDocuments({ assigned_to_id: user._id, status: 'Pending', scheduled_date: { $lt: new Date() } });
      personalSection  =
        `\n\nPersonal Stats for ${user.full_name} (${user.role}):\n` +
        `- My Assigned Leads: ${myLeads} (${myNewToday} new today)\n` +
        `- My Pending Follow-Ups: ${myFUs} (${myOverdue} overdue)`;
      if (user.role === 'Closer') {
        const myBkgs = await Booking.aggregate([
          { $match: { closer_id: user._id } },
          { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$sale_value' } } }
        ]);
        personalSection +=
          `\n- My Bookings: ${myBkgs[0]?.count || 0}, ` +
          `Revenue: ₹${(myBkgs[0]?.revenue || 0).toLocaleString('en-IN')}`;
      }
    }

    const systemPrompt =
      `You are TG Assistant, the AI helper for TrueGrowth CRM — a real estate sales CRM used in India.\n` +
      `You only answer questions about CRM data. Be concise, helpful, and use Indian context (₹ for currency).\n` +
      `Current CRM Data:\n` +
      `- Total Leads: ${totalLeads} (${newToday} new today)\n` +
      `- Lead Status Breakdown: ${statusSummary}\n` +
      `- Total Bookings: ${totalBookings}\n` +
      `- Total Revenue: ₹${totalRevenue.toLocaleString('en-IN')}\n` +
      `- Pending Follow-Ups: ${pendingFUs} (${overdueFUs} overdue)\n` +
      `- Total Projects: ${totalProjects}\n` +
      `- Project Details:\n${projectSummary}\n` +
      `- Top Lead Sources: ${sourceSummary}\n` +
      `- Logged in user: ${user.full_name} (${user.role})` +
      personalSection + '\n' +
      (isAdminOrMD(user)
        ? 'This user is a Manager/Admin and can see all team data.'
        : `IMPORTANT: This user is a ${user.role}. Only reference their personal stats, not team-wide numbers.`) +
      '\nAnswer only based on this data. If asked something outside CRM scope, politely decline.';

    // Multi-turn conversation memory — last 8 exchanges sent to Groq
    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...Array.isArray(history) ? history.slice(-8).map(h => ({
        role: h.type === 'user' ? 'user' : 'assistant',
        content: String(h.text || '').replace(/<[^>]+>/g, '').trim()
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
      })
    });

    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content || 'Sorry, I could not process that.';
    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err);
    res.json({ reply: 'Something went wrong. Try again.' });
  }
});

module.exports = router;
