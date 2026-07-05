// TrueGrowth CRM — server.js
// Node.js + Express + MongoDB (Mongoose) + EJS + SendGrid + node-cron
//-------------------------------------------------------------------------
//require('dotenv').config();
//require('dotenv').config({ path: '.env.development.local' });
//-------------------------------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.development.local' });
}

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { parse: parseCsvSync } = require('csv-parse/sync');
const sgMail = require('@sendgrid/mail');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');

// ---------------------------------------------------------------------------
// ENV VALIDATION
// ---------------------------------------------------------------------------
if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error('ERROR: MONGODB_URI and JWT_SECRET must be set in Render.com environment variables.');
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('ERROR: JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (!process.env.SENDGRID_API_KEY) {
  console.warn('WARN: SENDGRID_API_KEY not set — email digest will not send.');
} else {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// MODELS
// ---------------------------------------------------------------------------
const { Schema, Types } = mongoose;

const User = mongoose.model('User', new Schema({
  full_name: { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: ['Admin', 'MD', 'Caller', 'Closer'], required: true },
  phone:     String,
  status:    { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  created_at:{ type: Date, default: Date.now }
}));

const Project = mongoose.model('Project', new Schema({
  name:            { type: String, required: true },
  developer:       String,
  location:        String,
  city:            String,
  state:           String,
  project_type:    { type: String, enum: ['Apartment', 'Villa', 'Plot', 'Commercial', 'Penthouse', 'Studio', 'Other'] },
  status:          { type: String, enum: ['Upcoming', 'Under Construction', 'Ready to Move', 'Sold Out'], default: 'Upcoming' },
  total_units:     { type: Number, default: 0 },
  available_units: { type: Number, default: 0 },
  price_range:     String,
  notes:           String,
  created_at:      { type: Date, default: Date.now }
}));

const Unit = mongoose.model('Unit', new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  unit_number: { type: String, required: true },
  type:        String,
  bhk:         String,
  area_sqft:   Number,
  base_price:  Number,
  status:      { type: String, enum: ['Available', 'Blocked', 'Booked', 'Sold'], default: 'Available' },
  notes:       String
}));

const LeadSource = mongoose.model('LeadSource', new Schema({
  name:    { type: String, required: true },
  channel: { type: String, enum: ['Online', 'Offline', 'Referral', 'Direct'] },
  active:  { type: Boolean, default: true },
  notes:   String
}));

const LEAD_STATUSES = ['New', 'Working', 'Qualified', 'Site Visit Scheduled', 'Negotiation', 'Booked', 'Lost', 'Not Interested'];
const Lead = mongoose.model('Lead', new Schema({
  name:               { type: String, required: true },
  phone:              { type: String, required: true },
  email:              String,
  city:               String,
  project_id:         { type: Schema.Types.ObjectId, ref: 'Project' },
  budget_range:       String,
  source_id:          { type: Schema.Types.ObjectId, ref: 'LeadSource', required: true },
  status:             { type: String, enum: LEAD_STATUSES, default: 'New' },
  assigned_caller_id: { type: Schema.Types.ObjectId, ref: 'User' },
  assigned_closer_id: { type: Schema.Types.ObjectId, ref: 'User' },
  notes:              String,
  created_at:         { type: Date, default: Date.now },
  qualified_at:       Date,
  booked_at:          Date
}));

const FollowUp = mongoose.model('FollowUp', new Schema({
  lead_id:        { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
  assigned_to_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  scheduled_date: { type: Date, required: true },
  completed_date: Date,
  type:           { type: String, enum: ['Call', 'WhatsApp', 'Site Visit', 'Meeting', 'Email', 'Other'], default: 'Call' },
  status:         { type: String, enum: ['Pending', 'Completed', 'Missed', 'Cancelled'], default: 'Pending' },
  outcome:        String,
  notes:          String,
  created_at:     { type: Date, default: Date.now }
}));

const Booking = mongoose.model('Booking', new Schema({
  lead_id:        { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
  project_id:     { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  unit_id:        { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
  closer_id:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
  booking_date:   { type: Date, default: Date.now },
  sale_value:     { type: Number, default: 0 },
  booking_amount: { type: Number, required: true },
  status:         { type: String, enum: ['Tentative', 'Confirmed', 'Cancelled'], default: 'Tentative' },
  notes:          String,
  created_at:     { type: Date, default: Date.now }
}));

const Payment = mongoose.model('Payment', new Schema({
  booking_id:   { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  amount:       { type: Number, required: true },
  payment_date: { type: Date, default: Date.now },
  method:       { type: String, enum: ['Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Card', 'Other'] },
  reference:    String,
  notes:        String
}));

const AuditLog = mongoose.model('AuditLog', new Schema({
  user_email: String,
  action:     String,
  entity:     String,
  entity_id:  String,
  details:    Schema.Types.Mixed,
  created_at: { type: Date, default: Date.now, expires: 15552000 } // 180 days TTL
}));

const Setting = mongoose.model('Setting', new Schema({
  key:   { type: String, required: true, unique: true },
  value: Schema.Types.Mixed
}));

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function formatMoney(n) {
  return '\u20B9' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function formatDate(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function clean(v) { return typeof v === 'string' ? v.trim() : v; }
function cleanBody(body) {
  const out = {};
  for (const k of Object.keys(body)) out[k] = clean(body[k]);
  return out;
}
function objIdOrNull(v) {
  return v && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : null;
}

async function audit(userEmail, action, entity, entityId, details) {
  try {
    await AuditLog.create({ user_email: userEmail, action, entity, entity_id: entityId ? String(entityId) : '', details: details || {} });
  } catch (e) { console.error('Audit log failed:', e.message); }
}

async function getSettings() {
  const docs = await Setting.find();
  const map = {
    company_name: 'TrueGrowth Realty', currency: 'INR', currency_symbol: '\u20B9',
    tax_rate: '0', booking_prefix: 'TG-', lead_prefix: 'LD-', default_commission: '0'
  };
  docs.forEach(d => { map[d.key] = d.value; });
  return map;
}

async function getNextCaller() {
  const callers = await User.find({ role: 'Caller', status: 'Active' }).select('_id');
  if (!callers.length) return null;
  const counts = await Lead.aggregate([
    { $match: { assigned_caller_id: { $in: callers.map(c => c._id) } } },
    { $group: { _id: '$assigned_caller_id', count: { $sum: 1 } } }
  ]);
  const countMap = {};
  callers.forEach(c => { countMap[String(c._id)] = 0; });
  counts.forEach(c => { countMap[String(c._id)] = c.count; });
  return callers.sort((a, b) => countMap[String(a._id)] - countMap[String(b._id)])[0]._id;
}

function isManager(role) { return ['Admin', 'MD'].includes(role); }

// Visibility filters per role
function visibleLeadFilter(user) {
  if (isManager(user.role)) return {};
  if (user.role === 'Caller') return { assigned_caller_id: new Types.ObjectId(user.userId) };
  return { assigned_closer_id: new Types.ObjectId(user.userId) }; // Closer
}
function visibleFollowUpFilter(user) {
  if (isManager(user.role)) return {};
  return { assigned_to_id: new Types.ObjectId(user.userId) };
}
function visibleBookingFilter(user) {
  if (isManager(user.role)) return {};
  if (user.role === 'Closer') return { closer_id: new Types.ObjectId(user.userId) };
  return { _id: null }; // Callers see no bookings
}
async function canEditLead(user, leadId) {
  if (isManager(user.role)) return true;
  const lead = await Lead.findById(leadId).select('assigned_caller_id assigned_closer_id');
  if (!lead) return false;
  const uid = String(user.userId);
  return String(lead.assigned_caller_id || '') === uid || String(lead.assigned_closer_id || '') === uid;
}

// ---------------------------------------------------------------------------
// AUTH MIDDLEWARE
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const token = req.cookies.tg_token;
  if (!token) return res.redirect('/login');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    res.clearCookie('tg_token');
    res.redirect('/login?error=' + encodeURIComponent('Session expired, please sign in again'));
  }
}
function requireAdmin(req, res, next) {
  if (!['Admin', 'MD'].includes(req.user.role)) return res.status(403).send('Forbidden');
  next();
}

// ---------------------------------------------------------------------------
// APP SETUP
// ---------------------------------------------------------------------------
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false // Bootstrap/FontAwesome/Chart.js CDNs + inline scripts in EJS
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.locals.formatMoney = formatMoney;
app.locals.formatDate = formatDate;
app.locals.formatDateTime = formatDateTime;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.csv')) cb(null, true);
    else cb(new Error('Only .csv files are allowed'));
  }
});

// ---------------------------------------------------------------------------
// PUBLIC ROUTES
// ---------------------------------------------------------------------------
app.get('/', (req, res) => res.redirect('/app'));

app.get('/login', (req, res) => {
  res.render('login', { error: req.query.error || null });
});

app.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = clean(req.body.email || '').toLowerCase();
    const password = req.body.password || '';
    const user = await User.findOne({ email, status: 'Active' });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.redirect('/login?error=' + encodeURIComponent('Invalid email or password'));
    }
    const token = jwt.sign(
      { userId: user._id, role: user.role, email: user.email, name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('tg_token', token, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000
    });
    await audit(user.email, 'login', 'User', user._id, {});
    res.redirect('/app?page=dashboard');
  } catch (e) {
    console.error('Login error:', e);
    res.redirect('/login?error=' + encodeURIComponent('An error occurred, please try again'));
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('tg_token');
  res.redirect('/login');
});

// ---------------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------------
app.get('/api/units/:projectId', requireAuth, async (req, res) => {
  try {
    const units = await Unit.find({ project_id: req.params.projectId, status: 'Available' }).sort('unit_number');
    res.json(units);
  } catch (e) { res.status(500).json({ error: 'Failed to load units' }); }
});

app.get('/api/lead-timeline/:leadId', requireAuth, async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = await Lead.findById(leadId).populate('source_id project_id assigned_caller_id assigned_closer_id');
    if (!lead) return res.status(404).json({ error: 'Not found' });

    // RBAC: non-managers can only view their own leads
    if (!isManager(req.user.role)) {
      const uid = String(req.user.userId);
      const owns = String(lead.assigned_caller_id?._id || '') === uid || String(lead.assigned_closer_id?._id || '') === uid;
      if (!owns) return res.status(403).json({ error: 'Forbidden' });
    }

    const events = [];
    events.push({ type: 'created', date: lead.created_at, label: 'Lead created', detail: 'Source: ' + (lead.source_id?.name || '\u2014') });
    if (lead.qualified_at) events.push({ type: 'qualified', date: lead.qualified_at, label: 'Qualified', detail: 'Closer: ' + (lead.assigned_closer_id?.full_name || '\u2014') });
    if (lead.booked_at) events.push({ type: 'booked', date: lead.booked_at, label: 'Booked', detail: '' });

    const followups = await FollowUp.find({ lead_id: leadId }).populate('assigned_to_id').sort('scheduled_date');
    followups.forEach(f => events.push({
      type: f.status === 'Completed' ? 'followup_done' : 'followup',
      date: f.scheduled_date,
      label: f.type + ' \u2014 ' + f.status,
      detail: f.outcome || f.notes || ''
    }));

    const booking = await Booking.findOne({ lead_id: leadId }).populate('unit_id project_id closer_id');
    if (booking) events.push({
      type: 'booking', date: booking.booking_date, label: 'Booking created',
      detail: 'Unit: ' + (booking.unit_id?.unit_number || '\u2014') + ', Value: ' + formatMoney(booking.sale_value)
    });

    const auditEvents = await AuditLog.find({ entity_id: String(leadId) }).sort('created_at').limit(20);
    auditEvents.forEach(a => events.push({ type: 'audit', date: a.created_at, label: a.action, detail: a.user_email }));

    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(events);
  } catch (e) {
    console.error('Timeline error:', e);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// ---------------------------------------------------------------------------
// RECEIPT
// ---------------------------------------------------------------------------
app.get('/app/receipt/:bookingId', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId).populate('lead_id project_id unit_id closer_id');
    if (!booking) return res.status(404).send('Booking not found');
    // RBAC: closers can only view their own booking receipts
    if (!isManager(req.user.role)) {
      if (req.user.role !== 'Closer' || String(booking.closer_id?._id) !== String(req.user.userId)) {
        return res.status(403).send('Forbidden');
      }
    }
    const payments = await Payment.find({ booking_id: booking._id }).sort('payment_date');
    const amount_paid = payments.reduce((s, p) => s + p.amount, 0);
    const settings = await getSettings();
    res.render('receipt', { booking, payments, amount_paid, settings });
  } catch (e) {
    console.error('Receipt error:', e);
    res.status(500).send('An error occurred.');
  }
});

// ---------------------------------------------------------------------------
// CSV IMPORT
// ---------------------------------------------------------------------------
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

app.post('/app/import-leads', requireAuth, requireAdmin, (req, res) => {
  upload.single('csv_file')(req, res, async (err) => {
    if (err) return res.redirect('/app?page=leads&msg=' + encodeURIComponent('Upload failed: ' + err.message));
    if (!req.file) return res.redirect('/app?page=leads&msg=' + encodeURIComponent('No file uploaded.'));
    try {
      const records = parseCsvSync(req.file.buffer, { columns: h => h.map(c => c.trim().toLowerCase()), skip_empty_lines: true, trim: true });
      const results = { success: 0, failed: 0, errors: [] };

      for (const row of records) {
        try {
          if (!row.name || !row.phone) { results.failed++; results.errors.push('Row missing name/phone'); continue; }
          const source = row.source_name
            ? await LeadSource.findOne({ name: new RegExp('^' + escapeRegex(row.source_name) + '$', 'i') })
            : null;
          if (!source) { results.failed++; results.errors.push('Row ' + row.name + ': source not found'); continue; }

          const project = row.project_name
            ? await Project.findOne({ name: new RegExp('^' + escapeRegex(row.project_name) + '$', 'i') })
            : null;

          const caller_id = await getNextCaller();

          const lead = await Lead.create({
            name: row.name,
            phone: row.phone,
            email: row.email || '',
            city: row.city || '',
            source_id: source._id,
            project_id: project ? project._id : null,
            budget_range: row.budget_range || '',
            notes: row.notes || 'Imported via CSV',
            assigned_caller_id: caller_id,
            status: 'New',
            created_at: new Date()
          });

          await audit(req.user.email, 'csv_import', 'Lead', lead._id, { name: row.name });
          results.success++;
        } catch (e) {
          results.failed++;
          results.errors.push('Row ' + (row.name || '?') + ': ' + e.message);
        }
      }
      res.redirect('/app?page=leads&msg=' + encodeURIComponent('Imported ' + results.success + ' leads. ' + results.failed + ' failed.'));
    } catch (e) {
      console.error('CSV import error:', e);
      res.redirect('/app?page=leads&msg=' + encodeURIComponent('CSV parse failed: ' + e.message));
    }
  });
});

// ---------------------------------------------------------------------------
// APP HANDLER (GET + POST)
// ---------------------------------------------------------------------------
async function handlePostAction(req) {
  const body = cleanBody(req.body);
  const action = body.action;
  const user = req.user;
  const manager = isManager(user.role);

  switch (action) {
    case 'add_lead': {
      const caller = objIdOrNull(body.assigned_caller_id) || await getNextCaller();
      const lead = await Lead.create({
        name: body.name, phone: body.phone, email: body.email || '', city: body.city || '',
        source_id: objIdOrNull(body.source_id),
        project_id: objIdOrNull(body.project_id),
        budget_range: body.budget_range || '',
        status: 'New',
        assigned_caller_id: caller,
        assigned_closer_id: objIdOrNull(body.assigned_closer_id),
        notes: body.notes || '',
        created_at: new Date()
      });
      await audit(user.email, 'create', 'Lead', lead._id, { name: body.name });
      return 'Lead added.';
    }
    case 'update_lead': {
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const update = {
        name: body.name, phone: body.phone, email: body.email || '', city: body.city || '',
        budget_range: body.budget_range || '', notes: body.notes || ''
      };
      if (body.source_id) update.source_id = objIdOrNull(body.source_id);
      update.project_id = objIdOrNull(body.project_id);
      if (manager) {
        update.assigned_caller_id = objIdOrNull(body.assigned_caller_id);
        update.assigned_closer_id = objIdOrNull(body.assigned_closer_id);
      }
      if (body.status && LEAD_STATUSES.includes(body.status)) {
        update.status = body.status;
        const existing = await Lead.findById(body.lead_id).select('qualified_at booked_at');
        if (body.status === 'Qualified' && !existing.qualified_at) update.qualified_at = new Date();
        if (body.status === 'Booked' && !existing.booked_at) update.booked_at = new Date();
      }
      await Lead.findByIdAndUpdate(body.lead_id, update);
      await audit(user.email, 'update', 'Lead', body.lead_id, { name: body.name });
      return 'Lead updated.';
    }
    case 'quick_disposition': {
      if (!['Not Interested', 'Working', 'Qualified'].includes(body.status)) {
        throw Object.assign(new Error('Invalid status'), { status: 400 });
      }
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const update = { status: body.status };
      //if (body.status === 'Qualified') update.qualified_at = new Date();
      const existing = await Lead.findById(body.lead_id).select('qualified_at');
      if (body.status === 'Qualified' && !existing?.qualified_at) {
        update.qualified_at = new Date();
      }

      await Lead.findByIdAndUpdate(body.lead_id, update);
      await audit(user.email, 'update', 'Lead', body.lead_id, { quick_disposition: body.status });
      return 'Lead marked ' + body.status + '.';
    }
    case 'qualify_lead': {
      if (user.role === 'Closer') throw Object.assign(new Error('Forbidden'), { status: 403 });
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Lead.findByIdAndUpdate(body.lead_id, {
        status: 'Qualified',
        assigned_closer_id: objIdOrNull(body.assigned_closer_id),
        qualified_at: new Date()
      });
      await audit(user.email, 'update', 'Lead', body.lead_id, { qualified: true });
      return 'Lead qualified.';
    }
    case 'add_project': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const p = await Project.create({
        name: body.name, developer: body.developer, location: body.location, city: body.city,
        state: body.state, project_type: body.project_type || 'Other', status: body.status || 'Upcoming',
        total_units: Number(body.total_units || 0), available_units: Number(body.available_units || 0),
        price_range: body.price_range, notes: body.notes
      });
      await audit(user.email, 'create', 'Project', p._id, { name: body.name });
      return 'Project added.';
    }
    case 'update_project': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Project.findByIdAndUpdate(body.project_id, {
        name: body.name, developer: body.developer, location: body.location, city: body.city,
        state: body.state, project_type: body.project_type, status: body.status,
        total_units: Number(body.total_units || 0), available_units: Number(body.available_units || 0),
        price_range: body.price_range, notes: body.notes
      });
      await audit(user.email, 'update', 'Project', body.project_id, { name: body.name });
      return 'Project updated.';
    }
    case 'add_unit': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const u = await Unit.create({
        project_id: objIdOrNull(body.project_id), unit_number: body.unit_number, type: body.type,
        bhk: body.bhk, area_sqft: Number(body.area_sqft || 0), base_price: Number(body.base_price || 0),
        status: body.status || 'Available', notes: body.notes
      });
      await audit(user.email, 'create', 'Unit', u._id, { unit_number: body.unit_number });
      return 'Unit added.';
    }
    case 'update_unit': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Unit.findByIdAndUpdate(body.unit_id, {
        unit_number: body.unit_number, type: body.type, bhk: body.bhk,
        area_sqft: Number(body.area_sqft || 0), base_price: Number(body.base_price || 0),
        status: body.status, notes: body.notes
      });
      await audit(user.email, 'update', 'Unit', body.unit_id, { unit_number: body.unit_number });
      return 'Unit updated.';
    }
    case 'add_source': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const s = await LeadSource.create({ name: body.name, channel: body.channel, active: body.active === 'true' || body.active === 'on', notes: body.notes });
      await audit(user.email, 'create', 'LeadSource', s._id, { name: body.name });
      return 'Source added.';
    }
    case 'update_source': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await LeadSource.findByIdAndUpdate(body.source_id, { name: body.name, channel: body.channel, active: body.active === 'true' || body.active === 'on', notes: body.notes });
      await audit(user.email, 'update', 'LeadSource', body.source_id, { name: body.name });
      return 'Source updated.';
    }
    case 'add_user': {
      if (user.role !== 'Admin') throw Object.assign(new Error('Forbidden'), { status: 403 });
      if (!body.password || body.password.length < 6) throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 });
      const hashed = await bcrypt.hash(body.password, 12);
      const nu = await User.create({
        full_name: body.full_name, email: (body.email || '').toLowerCase(), password: hashed,
        role: body.role, phone: body.phone, status: body.status || 'Active'
      });
      await audit(user.email, 'create', 'User', nu._id, { email: body.email, role: body.role });
      return 'User added.';
    }
    case 'update_user': {
      if (user.role !== 'Admin') throw Object.assign(new Error('Forbidden'), { status: 403 });
      const update = { full_name: body.full_name, email: (body.email || '').toLowerCase(), role: body.role, phone: body.phone, status: body.status };
      if (body.password) update.password = await bcrypt.hash(body.password, 12);
      await User.findByIdAndUpdate(body.user_id, update);
      await audit(user.email, 'update', 'User', body.user_id, { email: body.email });
      return 'User updated.';
    }
    case 'add_followup': {
      if (!(await canEditLead(user, body.lead_id))) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const assignee = manager ? (objIdOrNull(body.assigned_to_id) || new Types.ObjectId(user.userId)) : new Types.ObjectId(user.userId);
      const f = await FollowUp.create({
        lead_id: objIdOrNull(body.lead_id), assigned_to_id: assignee,
        scheduled_date: new Date(body.scheduled_date), type: body.type || 'Call',
        status: 'Pending', notes: body.notes
      });
      await audit(user.email, 'create', 'FollowUp', f._id, { lead_id: body.lead_id, type: body.type });
      return 'Follow-up scheduled.';
    }
    case 'update_followup': {
      const f = await FollowUp.findById(body.followup_id);
      if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
      if (!manager && String(f.assigned_to_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const update = { scheduled_date: new Date(body.scheduled_date), type: body.type, notes: body.notes, status: body.status || f.status, outcome: body.outcome };
      if (manager && body.assigned_to_id) update.assigned_to_id = objIdOrNull(body.assigned_to_id);
      await FollowUp.findByIdAndUpdate(body.followup_id, update);
      await audit(user.email, 'update', 'FollowUp', body.followup_id, {});
      return 'Follow-up updated.';
    }
    case 'complete_followup': {
      const f = await FollowUp.findById(body.followup_id);
      if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
      if (!manager && String(f.assigned_to_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await FollowUp.findByIdAndUpdate(body.followup_id, { status: 'Completed', completed_date: new Date(), outcome: body.outcome || '' });
      await audit(user.email, 'update', 'FollowUp', body.followup_id, { completed: true });
      return 'Follow-up completed.';
    }
    case 'add_booking': {
      if (user.role === 'Caller') throw Object.assign(new Error('Forbidden'), { status: 403 });
      const leadId = objIdOrNull(body.lead_id);
      const lead = await Lead.findById(leadId);
      if (!lead) throw Object.assign(new Error('Lead not found'), { status: 404 });
      const closerId = manager ? (objIdOrNull(body.closer_id) || new Types.ObjectId(user.userId)) : new Types.ObjectId(user.userId);
      if (user.role === 'Closer' && String(lead.assigned_closer_id || '') !== String(user.userId)) {
        throw Object.assign(new Error('You can only book your own leads'), { status: 403 });
      }
      const b = await Booking.create({
        lead_id: leadId, project_id: objIdOrNull(body.project_id), unit_id: objIdOrNull(body.unit_id),
        closer_id: closerId, booking_date: body.booking_date ? new Date(body.booking_date) : new Date(),
        sale_value: Number(body.sale_value || 0), booking_amount: Number(body.booking_amount || 0),
        status: body.status || 'Tentative', notes: body.notes
      });
      await Unit.findByIdAndUpdate(body.unit_id, { status: 'Booked' });
      await Lead.findByIdAndUpdate(leadId, { status: 'Booked', booked_at: new Date() });
      await audit(user.email, 'create', 'Booking', b._id, { lead: lead.name, sale_value: body.sale_value });
      return 'Booking created.';
    }
    case 'update_booking': {
      const b = await Booking.findById(body.booking_id);
      if (!b) throw Object.assign(new Error('Not found'), { status: 404 });
      if (!manager && String(b.closer_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Booking.findByIdAndUpdate(body.booking_id, {
        sale_value: Number(body.sale_value || 0), booking_amount: Number(body.booking_amount || 0),
        booking_date: body.booking_date ? new Date(body.booking_date) : b.booking_date,
        status: body.status, notes: body.notes
      });
      await audit(user.email, 'update', 'Booking', body.booking_id, {});
      return 'Booking updated.';
    }
    case 'add_payment': {
      if (user.role === 'Caller') throw Object.assign(new Error('Forbidden'), { status: 403 });
      const b = await Booking.findById(body.booking_id);
      if (!b) throw Object.assign(new Error('Booking not found'), { status: 404 });
      if (!manager && String(b.closer_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const payments = await Payment.find({ booking_id: b._id });
      const paid = payments.reduce((s, p) => s + p.amount, 0);
      const amt = Number(body.amount || 0);
      if (amt <= 0) throw Object.assign(new Error('Amount must be positive'), { status: 400 });
      if (paid + amt > b.sale_value) throw Object.assign(new Error('Payment exceeds sale value. Paid: ' + formatMoney(paid) + ' of ' + formatMoney(b.sale_value)), { status: 400 });
      const p = await Payment.create({
        booking_id: b._id, amount: amt,
        payment_date: body.payment_date ? new Date(body.payment_date) : new Date(),
        method: body.method || 'Other', reference: body.reference, notes: body.notes
      });
      await audit(user.email, 'create', 'Payment', p._id, { booking_id: String(b._id), amount: amt });
      return 'Payment recorded.';
    }
    case 'save_settings': {
      if (user.role !== 'Admin') throw Object.assign(new Error('Forbidden'), { status: 403 });
      const keys = ['company_name', 'currency', 'currency_symbol', 'tax_rate', 'booking_prefix', 'lead_prefix', 'default_commission'];
      for (const key of keys) {
        if (body[key] !== undefined) {
          await Setting.findOneAndUpdate({ key }, { key, value: body[key] }, { upsert: true });
        }
      }
      await audit(user.email, 'update', 'Settings', '', {});
      return 'Settings saved.';
    }
    default:
      throw Object.assign(new Error('Unknown action'), { status: 400 });
  }
}

async function handleDelete(req) {
  const { table, id } = req.query;
  const user = req.user;
  const manager = isManager(user.role);

  switch (table) {
    case 'leads': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await FollowUp.deleteMany({ lead_id: id });
      await Lead.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Lead', id, {});
      break;
    }
    case 'projects': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const leadCount = await Lead.countDocuments({ project_id: id });
      const unitCount = await Unit.countDocuments({ project_id: id });
      if (leadCount > 0 || unitCount > 0) throw Object.assign(new Error('Cannot delete: project has leads or units'), { status: 400 });
      await Project.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Project', id, {});
      break;
    }
    case 'units': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Unit.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Unit', id, {});
      break;
    }
    case 'sources': {
      if (!manager) throw Object.assign(new Error('Forbidden'), { status: 403 });
      const leadCount = await Lead.countDocuments({ source_id: id });
      if (leadCount > 0) throw Object.assign(new Error('Cannot delete: source has leads'), { status: 400 });
      await LeadSource.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'LeadSource', id, {});
      break;
    }
    case 'users': {
      if (user.role !== 'Admin') throw Object.assign(new Error('Forbidden'), { status: 403 });
      if (String(id) === String(user.userId)) throw Object.assign(new Error('Cannot delete yourself'), { status: 400 });
      await User.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'User', id, {});
      break;
    }
    case 'followups': {
      const f = await FollowUp.findById(id);
      if (!f) break;
      if (!manager && String(f.assigned_to_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await FollowUp.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'FollowUp', id, {});
      break;
    }
    case 'bookings': {
      const b = await Booking.findById(id);
      if (!b) break;
      if (!manager && String(b.closer_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Payment.deleteMany({ booking_id: id });
      await Unit.findByIdAndUpdate(b.unit_id, { status: 'Available' });
      //await Lead.findByIdAndUpdate(b.lead_id, { status: 'Negotiation', booked_at: null });
      const lead = await Lead.findById(b.lead_id).select('assigned_closer_id');
      const restoreStatus = lead?.assigned_closer_id ? 'Negotiation' : 'Qualified';
      await Lead.findByIdAndUpdate(b.lead_id, { status: restoreStatus, booked_at: null });
      //------------------------------------------------------------------------------
      await Booking.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Booking', id, {});
      break;
    }
    case 'payments': {
      const p = await Payment.findById(id);
      if (!p) break;
      const b = await Booking.findById(p.booking_id);
      if (!manager && b && String(b.closer_id) !== String(user.userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      await Payment.findByIdAndDelete(id);
      await audit(user.email, 'delete', 'Payment', id, {});
      break;
    }
    default:
      throw Object.assign(new Error('Unknown table'), { status: 400 });
  }
}

const ADMIN_PAGES = ['users', 'settings', 'audit'];
const MANAGER_PAGES = ['reports', 'sources'];

async function appHandler(req, res) {
  try {
    const user = req.user;
    let page = String(req.query.page || 'dashboard');
    let success_msg = req.query.msg || null;

    // POST actions
    if (req.method === 'POST' && req.body && req.body.action) {
      try {
        const msg = await handlePostAction(req);
        return res.redirect('/app?page=' + encodeURIComponent(page) + '&msg=' + encodeURIComponent(msg));
      } catch (e) {
        if (e.status) return res.redirect('/app?page=' + encodeURIComponent(page) + '&msg=' + encodeURIComponent('Error: ' + e.message));
        throw e;
      }
    }

    // DELETE via GET query
    if (req.query.delete && req.query.table && req.query.id) {
      try {
        await handleDelete(req);
        return res.redirect('/app?page=' + encodeURIComponent(page) + '&msg=' + encodeURIComponent('Deleted successfully.'));
      } catch (e) {
        if (e.status) return res.redirect('/app?page=' + encodeURIComponent(page) + '&msg=' + encodeURIComponent('Error: ' + e.message));
        throw e;
      }
    }

    // Page-level RBAC
    if (ADMIN_PAGES.includes(page) && user.role !== 'Admin') page = 'dashboard';
    if (MANAGER_PAGES.includes(page) && !isManager(user.role)) page = 'dashboard';

    const leadFilter = visibleLeadFilter(user);
    const fuFilter = visibleFollowUpFilter(user);
    const bookingFilter = visibleBookingFilter(user);
    const userId = new Types.ObjectId(user.userId);

    const data = {};
    data.projects = await Project.find().sort('name');
    data.sources = await LeadSource.find().sort('name');

    if (page === 'dashboard') {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      data.total_leads = await Lead.countDocuments(leadFilter);
      data.total_bookings = await Booking.countDocuments(bookingFilter);
      data.total_projects = await Project.countDocuments();
      const fuOwnFilter = isManager(user.role) ? {} : { assigned_to_id: userId };
      data.pending_followups = await FollowUp.countDocuments({ ...fuOwnFilter, status: 'Pending' });
      data.overdue_followups = await FollowUp.countDocuments({ ...fuOwnFilter, status: 'Pending', scheduled_date: { $lt: new Date() } });
      const rev = await Booking.aggregate([
        ...(isManager(user.role) ? [] : [{ $match: bookingFilter }]),
        { $group: { _id: null, total: { $sum: '$sale_value' } } }
      ]);
      data.total_revenue = rev.length ? rev[0].total : 0;
      data.new_today = await Lead.countDocuments({ ...leadFilter, created_at: { $gte: startOfToday } });
      data.recent_leads = await Lead.find(leadFilter).sort('-created_at').limit(8).populate('project_id source_id assigned_caller_id');
      data.booking_trend = await Booking.aggregate([
        ...(isManager(user.role) ? [] : [{ $match: bookingFilter }]),
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$booking_date' } }, revenue: { $sum: '$sale_value' } } },
        { $sort: { _id: 1 } }, { $limit: 12 }
      ]);
      data.by_status = await Lead.aggregate([
        ...(Object.keys(leadFilter).length ? [{ $match: leadFilter }] : []),
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      data.closer_perf = isManager(user.role) ? await Booking.aggregate([
        { $group: { _id: '$closer_id', count: { $sum: 1 }, revenue: { $sum: '$sale_value' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'closer' } },
        { $sort: { revenue: -1 } }
      ]) : [];
    } else if (page === 'leads') {
      data.leads = await Lead.find(leadFilter)
        .populate('project_id source_id assigned_caller_id assigned_closer_id')
        .sort('-created_at');
      data.users = await User.find({ status: 'Active' }).select('full_name role');
    } else if (page === 'followups') {
      data.followups = await FollowUp.find(fuFilter).populate({ path: 'lead_id', select: 'name phone' }).populate('assigned_to_id').sort('scheduled_date');
      data.leads_for_fu = await Lead.find(leadFilter).select('name phone').sort('name');
      data.users = await User.find({ status: 'Active' }).select('full_name role');
    } else if (page === 'bookings') {
      if (user.role === 'Caller') { page = 'dashboard'; return res.redirect('/app?page=dashboard'); }
      data.bookings = await Booking.find(bookingFilter)
        .populate('lead_id project_id unit_id closer_id')
        .sort('-booking_date');
      data.payments = await Payment.find({ booking_id: { $in: data.bookings.map(b => b._id) } });
      data.closers = await User.find({ role: 'Closer', status: 'Active' }).select('full_name');
      data.qualified_leads = await Lead.find({ ...leadFilter, status: { $in: ['Qualified', 'Site Visit Scheduled', 'Negotiation'] } }).select('name phone project_id');
    } else if (page === 'projects') {
      if (!isManager(user.role)) return res.redirect('/app?page=dashboard');
      data.projects_detail = data.projects;
      data.units = await Unit.find().sort('unit_number');
    } else if (page === 'users') {
      data.users = await User.find().sort('full_name').select('-password');
    } else if (page === 'settings') {
      data.settings = await getSettings();
    } else if (page === 'reports') {
      const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const to = req.query.to ? new Date(req.query.to + 'T23:59:59') : new Date();
      data.report_from = from.toISOString().slice(0, 10);
      data.report_to = to.toISOString().slice(0, 10);
      const rangeFilter = { created_at: { $gte: from, $lte: to } };
      const bookingRangeFilter = { booking_date: { $gte: from, $lte: to } };
      const totalLeads = await Lead.countDocuments(rangeFilter);
      const qualified = await Lead.countDocuments({ ...rangeFilter, qualified_at: { $ne: null } });
      const booked = await Lead.countDocuments({ ...rangeFilter, status: 'Booked' });
      const funnel = await Lead.aggregate([{ $match: rangeFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
      data.conversion_report = {
        total: totalLeads, qualified, booked,
        qual_rate: totalLeads ? Math.round(qualified / totalLeads * 100) : 0,
        book_rate: totalLeads ? Math.round(booked / totalLeads * 100) : 0,
        funnel
      };
      data.followup_report = {
        pending: await FollowUp.countDocuments({ status: 'Pending' }),
        overdue: await FollowUp.countDocuments({ status: 'Pending', scheduled_date: { $lt: new Date() } }),
        completed: await FollowUp.countDocuments({ status: 'Completed', completed_date: { $gte: from, $lte: to } }),
        missed: await FollowUp.countDocuments({ status: 'Missed' })
      };
      const users = await User.find({ status: 'Active' }).select('full_name role');
      data.performance_report = [];
      for (const u of users) {
        const leadCount = await Lead.countDocuments({ $or: [{ assigned_caller_id: u._id }, { assigned_closer_id: u._id }] });
        const qualCount = await Lead.countDocuments({ assigned_caller_id: u._id, qualified_at: { $ne: null } });
        const bookings = await Booking.aggregate([{ $match: { closer_id: u._id, ...bookingRangeFilter } }, { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$sale_value' } } }]);
        const fuCount = await FollowUp.countDocuments({ assigned_to_id: u._id });
        data.performance_report.push({
          name: u.full_name, role: u.role, leads: leadCount, qualified: qualCount,
          bookings: bookings.length ? bookings[0].count : 0,
          revenue: bookings.length ? bookings[0].revenue : 0,
          followups: fuCount
        });
      }
    } else if (page === 'audit') {
      data.audit_logs = await AuditLog.find().sort('-created_at').limit(150);
    }

    res.render('app', { page, user, data, success_msg });
  } catch (e) {
    console.error('appHandler error:', e);
    res.status(500).send('An error occurred.');
  }
}

app.get('/app', requireAuth, appHandler);
app.post('/app', requireAuth, appHandler);

// 404 catch-all
app.use((req, res) => res.status(404).send('Route Not Found: ' + req.method + ' ' + req.url));

// ---------------------------------------------------------------------------
// DAILY EMAIL DIGEST
// ---------------------------------------------------------------------------
function digestKpiBox(label, count, color) {
  return '<td style="padding:6px;"><div style="background:' + color + ';border-radius:10px;padding:14px 8px;text-align:center;color:#ffffff;">' +
    '<div style="font-size:26px;font-weight:700;">' + count + '</div>' +
    '<div style="font-size:12px;opacity:0.9;">' + label + '</div></div></td>';
}

function followupCard(f) {
  const lead = f.lead_id || {};
  const when = new Date(f.scheduled_date).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return '<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px;">' +
    '<div style="font-weight:600;color:#111827;">' + (lead.name || 'Lead') + ' <span style="color:#6b7280;font-weight:400;">' + (lead.phone || '') + '</span></div>' +
    '<div style="font-size:13px;color:#374151;margin-top:4px;">' +
    '<span style="background:#1a56db;color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;">' + f.type + '</span> ' +
    '<span style="color:#6b7280;">' + when + '</span></div>' +
    (f.notes ? '<div style="font-size:12px;color:#6b7280;margin-top:4px;">' + f.notes + '</div>' : '') +
    '</div>';
}

function digestHtml(title, dateStr, kpis, sections) {
  return '<div style="background:#f4f7fe;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">' +
    '<div style="background:#082f49;padding:22px 24px;color:#ffffff;">' +
    '<div style="font-size:18px;font-weight:700;">TrueGrowth CRM</div>' +
    '<div style="font-size:13px;opacity:0.8;margin-top:2px;">' + title + ' \u2014 ' + dateStr + '</div></div>' +
    '<div style="padding:18px 18px 8px;"><table width="100%" cellpadding="0" cellspacing="0"><tr>' + kpis + '</tr></table></div>' +
    '<div style="padding:8px 24px 8px;">' + sections + '</div>' +
    '<div style="padding:8px 24px 20px;text-align:center;">' +
    '<a href="' + (process.env.APP_URL || '#') + '" style="display:inline-block;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:8px;padding:11px 26px;font-weight:600;font-size:14px;">Open CRM</a></div>' +
    '<div style="padding:14px 24px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;">You are receiving this because you have an active TrueGrowth CRM account. Manage notification preferences in the CRM.</div>' +
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

    for (const u of users.filter(x => ['Caller', 'Closer'].includes(x.role))) {
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
    for (const m of users.filter(x => ['Admin', 'MD'].includes(x.role))) {
      const kpis = digestKpiBox('Team Overdue', totalOverdue, totalOverdue > 0 ? '#dc2626' : '#6b7280') +
        digestKpiBox('New Leads Today', newToday, '#1a56db') +
        digestKpiBox('Active Agents', teamStats.length, '#059669');
      const rows = teamStats.map(t =>
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;">' + t.name + ' <span style="color:#6b7280;">(' + t.role + ')</span></td>' +
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

cron.schedule('30 2 * * *', sendDailyDigest, { timezone: 'Asia/Kolkata' }); // 02:30 UTC = 08:00 IST

// ---------------------------------------------------------------------------
// SEED + START
// ---------------------------------------------------------------------------
async function initAdmin() {
  try {
    const exists = await User.findOne({ $or: [{ role: 'Admin' }, { email: 'admin@truegrowth.com' }] });
    if (exists) return;
    const hashed = await bcrypt.hash('Admin@123', 12);
    await User.create({
      full_name: 'Administrator',
      email: 'admin@truegrowth.com',
      password: hashed,
      role: 'Admin',
      status: 'Active'
    });
    console.log('Admin user seeded: admin@truegrowth.com / Admin@123');
  } catch (e) {
    if (e.code === 11000) return; // already seeded by a concurrent restart
    throw e;
  }
}

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await initAdmin();
    app.listen(PORT, () => console.log('TrueGrowth CRM running on port ' + PORT));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
