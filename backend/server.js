const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mock RTO status feed, used by the sidebar / marquee to feel "alive".
app.get('/api/notices', (req, res) => {
  res.json({
    notices: [
      'URGENT: RTO Server Maintenance scheduled 11 PM - 2 AM tonight',
      'New Rule: Aadhaar linking mandatory from next cycle w.e.f. immediate effect',
      'Slot booking for Learner Licence Test temporarily suspended in 4 RTOs',
      'Beware of fraudulent agents demanding extra payment - report to helpline'
    ]
  });
});

// Simulates a flaky government backend: ~2s latency, and a coin-flip between
// success / one of a few "realistic" validation failures. This exists so the
// frontend has to handle a loading state AND dynamically render server-driven
// error messages, not just client-side validation.
app.post('/api/submit-application', (req, res) => {
  const body = req.body || {};

  setTimeout(() => {
    const outcomes = [
      { ok: true },
      { ok: false, code: 'RTO_TIMEOUT', message: 'RTO Server Timeout. Please retry after some time.' },
      { ok: false, code: 'DUPLICATE_APPLICATION', message: 'An application with this Aadhaar number is already in process.' },
      { ok: false, code: 'INVALID_RTO_CODE', message: 'RTO Office Code not recognized. Please verify and re-enter.' }
    ];

    // Simple structural validation, on top of the random flaky outcomes,
    // so a genuinely incomplete submission always fails rather than only
    // "sometimes" failing.
    const missing = ['fullName', 'dob', 'rtoCode', 'licenceType'].filter((f) => !body[f]);
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        code: 'MISSING_FIELDS',
        message: `Mandatory field(s) missing: ${missing.join(', ')}`
      });
    }

    const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
    if (outcome.ok) {
      return res.json({
        ok: true,
        applicationId: `DL-${Math.floor(100000 + Math.random() * 900000)}`,
        message: 'Application submitted successfully. Please save your Application ID.'
      });
    }
    return res.status(503).json(outcome);
  }, 2000);
});

// Draft save is instant and always succeeds — deliberately inconsistent with
// the submit endpoint, mirroring how these portals behave in the wild.
app.post('/api/save-draft', (req, res) => {
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Cognia obstacle-course portal running at http://localhost:${PORT}`);
});
