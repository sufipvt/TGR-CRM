// Shared test setup: a real MongoDB (CI runs one as a service container; locally
// point TEST_MONGODB_URI at any throwaway database), the real Express app, and a
// small company with two teams so access rules can be checked from every role.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-1234';
const baseUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
// One database per test file so files can't see each other's data.
process.env.MONGODB_URI = baseUri.replace(/\/?$/, '/') + 'tgcrm_test_' + process.pid;

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const models = require('../models');

let server, baseUrl;

async function start() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.db.dropDatabase();
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  return seed();
}

async function stop() {
  if (server) await new Promise(r => server.close(r));
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
}

async function seed() {
  const { User, Team, LeadSource, Project, Unit, Lead, FollowUp, Booking } = models;
  const pw = 'x'; // never used: tests sign session cookies directly
  const teamA = await Team.create({ name: 'Team A' });
  const teamB = await Team.create({ name: 'Team B' });
  const superAdmin = await User.create({ full_name: 'Sam Super', email: 'super@t.test', password: pw, role: 'Super Admin' });
  const admin = await User.create({ full_name: 'Ada Admin', email: 'admin@t.test', password: pw, role: 'Admin' });
  const tlA = await User.create({ full_name: 'Tara LeaderA', email: 'tla@t.test', password: pw, role: 'Team Leader', team_id: teamA._id });
  const subA = await User.create({ full_name: 'Sid SubA', email: 'suba@t.test', password: pw, role: 'Sub Team Leader', team_id: teamA._id });
  const subB = await User.create({ full_name: 'Bea SubB', email: 'subb@t.test', password: pw, role: 'Sub Team Leader', team_id: teamB._id });
  const loose = await User.create({ full_name: 'Uma Unassigned', email: 'loose@t.test', password: pw, role: 'Sub Team Leader' });
  await Team.updateOne({ _id: teamA._id }, { team_leader_id: tlA._id });

  const source = await LeadSource.create({ name: 'Website', channel: 'Online' });
  const project = await Project.create({ name: 'Green Acres' });
  const unitA = await Unit.create({ project_id: project._id, unit_number: 'A-101' });
  const unitB = await Unit.create({ project_id: project._id, unit_number: 'B-201', status: 'Booked' });

  const leadA = await Lead.create({ name: "Anil D'Souza", phone: '9000000001', source_id: source._id, assigned_caller_id: subA._id });
  const leadB = await Lead.create({ name: 'Bina Rao', phone: '9000000002', source_id: source._id, assigned_caller_id: subB._id });
  const fuA = await FollowUp.create({ lead_id: leadA._id, assigned_to_id: subA._id, scheduled_date: new Date() });
  const fuB = await FollowUp.create({ lead_id: leadB._id, assigned_to_id: subB._id, scheduled_date: new Date() });
  const bookingB = await Booking.create({ lead_id: leadB._id, project_id: project._id, unit_id: unitB._id, closer_id: subB._id, booking_amount: 100000, sale_value: 5000000 });

  return { teamA, teamB, superAdmin, admin, tlA, subA, subB, loose, source, project, unitA, unitB, leadA, leadB, fuA, fuB, bookingB };
}

// A logged-in client for one user. Requests never follow redirects so tests can
// read the flash message the app puts in the Location header.
function as(user) {
  const token = jwt.sign(
    { userId: user._id, role: user.role, email: user.email, name: user.full_name, team_id: user.team_id || null },
    process.env.JWT_SECRET, { expiresIn: '1h' }
  );
  const headers = { cookie: 'tg_token=' + token };
  const request = async (method, path, body) => {
    const opts = { method, headers: { ...headers }, redirect: 'manual' };
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/x-www-form-urlencoded';
      opts.body = new URLSearchParams(body).toString();
    }
    const res = await fetch(baseUrl + path, opts);
    const location = res.headers.get('location') || '';
    const msg = new URL(location || '/', baseUrl).searchParams.get('msg');
    return { status: res.status, location, msg, text: () => res.text(), json: () => res.json() };
  };
  return {
    get: path => request('GET', path),
    post: (path, body) => request('POST', path, body),
    postJson: async (path, body) => {
      const res = await fetch(baseUrl + path, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      return { status: res.status, json: () => res.json() };
    }
  };
}

module.exports = { start, stop, as, models, baseUrl: () => baseUrl };
