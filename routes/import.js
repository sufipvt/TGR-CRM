// CSV lead import
const express = require('express');
const { parse: parseCsvSync } = require('csv-parse/sync');
const { Project, LeadSource, Lead } = require('../models');
const { escapeRegex } = require('../utils/request');
const { audit } = require('../services/audit');
const { getNextCaller } = require('../services/assignment');
const { requireAuth, requireAdmin, refreshUserContext } = require('../middleware/auth');
const { expensiveOpLimiter } = require('../middleware/rateLimits');
const { upload } = require('../middleware/upload');

const router = express.Router();

// ---------------------------------------------------------------------------
// CSV IMPORT
// ---------------------------------------------------------------------------
router.post('/app/import-leads', requireAuth, expensiveOpLimiter, refreshUserContext, requireAdmin, (req, res) => {
  upload.single('csv_file')(req, res, async (err) => {
    if (err) return res.redirect('/app?page=leads&msg=' + encodeURIComponent('Upload failed: ' + err.message));
    if (!req.file) return res.redirect('/app?page=leads&msg=' + encodeURIComponent('No file uploaded.'));
    try {
      // Accept optional column mapping from the smart mapper UI
      let mapping = null;
      if (req.body.column_mapping) {
        try { mapping = JSON.parse(req.body.column_mapping); } catch(e) {}
      }

      // If mapping provided → keep original header casing; else → lowercase (standard template)
      const records = parseCsvSync(req.file.buffer, {
        // Header names become object keys: drop any that could reach an object's
        // prototype (csv-parse advisory GHSA-8cw4-87c7-c6xx).
        columns: h => h.map(c => {
          const name = mapping ? c.trim() : c.trim().toLowerCase();
          return ['__proto__', 'constructor', 'prototype'].includes(name) ? false : name;
        }),
        skip_empty_lines: true,
        trim: true
      });

      // Read a field using mapping or standard column name
      function getField(row, field) {
        if (mapping && mapping[field]) return (row[mapping[field]] || '').trim();
        return (row[field] || '').trim();
      }

      const results = { success: 0, failed: 0, errors: [] };

      for (const row of records) {
        try {
          const name  = getField(row, 'name');
          const phone = getField(row, 'phone');
          if (!name || !phone) {
            results.failed++;
            results.errors.push('Row missing name/phone');
            continue;
          }

          // Find or auto-create lead source
          const source_name = getField(row, 'source_name');
          let source = source_name
            ? await LeadSource.findOne({ name: new RegExp('^' + escapeRegex(source_name) + '$', 'i') })
            : null;

          // Auto-create source if it doesn't exist
          if (!source && source_name) {
            source = await LeadSource.create({
              name: source_name.trim(),
              channel: 'Online',
              active: true,
              notes: 'Auto-created during CSV import'
            });
            await audit(req.user.email, 'create', 'LeadSource', source._id, {
              name: source_name, auto_created: true
            });
          }

          // Fallback — no source column, use first active source
          if (!source) {
            source = await LeadSource.findOne({ active: true }).sort('name');
          }

          // Last resort — create generic source
          if (!source) {
            source = await LeadSource.create({
              name: 'Imported',
              channel: 'Online',
              active: true,
              notes: 'Auto-created as fallback during CSV import'
            });
          }

          // Find project if provided
          const project_name = getField(row, 'project_name');
          const project = project_name
            ? await Project.findOne({ name: new RegExp('^' + escapeRegex(project_name) + '$', 'i') })
            : null;

          const caller_id = await getNextCaller();

          const lead = await Lead.create({
            name,
            phone,
            email:        getField(row, 'email'),
            city:         getField(row, 'city'),
            source_id:    source._id,
            project_id:   project ? project._id : null,
            budget_range: getField(row, 'budget_range'),
            notes:        getField(row, 'notes') || 'Imported via CSV',
            assigned_caller_id: caller_id,
            status: 'New',
            created_at: new Date()
          });

          await audit(req.user.email, 'csv_import', 'Lead', lead._id, { name });
          results.success++;
        } catch (e) {
          results.failed++;
          results.errors.push((getField(row, 'name') || '?') + ': ' + e.message);
        }
      }

      res.redirect('/app?page=leads&msg=' + encodeURIComponent(
        'Imported ' + results.success + ' leads. ' +
        (results.failed ? results.failed + ' failed.' : 'All successful! ✓')
      ));
    } catch (e) {
      console.error('CSV import error:', e);
      res.redirect('/app?page=leads&msg=' + encodeURIComponent('CSV parse failed: ' + e.message));
    }
  });
});

module.exports = router;
