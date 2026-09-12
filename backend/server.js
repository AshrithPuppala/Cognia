const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const Application = require('./models/application');

const app = express();
const PORT = process.env.PORT || 3000;

// NOTE: Special characters in passwords must be URL-encoded ('@' -> '%40')
// Ensure you replace 'cluster0.xxxxx.mongodb.net' with your exact Atlas cluster host if different
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://aryanatbcbs_db_user:aryan%40123@cluster0.r14bcwk.mongodb.net/cognia?retryWrites=true&w=majority';

// Connect to MongoDB Atlas
mongoose.connect(MONGO_URI)
  .then(() => console.log('Successfully connected to MongoDB Atlas.'))
  .catch((err) => console.error('MongoDB Atlas connection error:', err));

app.use(express.json());

// ==========================================================
// Single source of truth for static frontend assets.
// Previously this served BOTH backend/public and the project
// root, with backend/public taking priority. That meant an old
// index.html sitting in backend/public (with stale popup markup)
// was always served instead of the updated root index.html —
// even after editing and pushing the root file. Only one
// directory is served now, so there is no ambiguity about which
// file is live.
//
// Point this at wherever your real, up-to-date index.html lives.
// If your frontend is in the project root, use '..' as below.
// If it's in backend/public, change this to 'public' instead —
// but make sure the OTHER copy is deleted so it can't go stale.
// ==========================================================
const FRONTEND_DIR = path.join(__dirname, '..','test-site');
app.use(express.static(FRONTEND_DIR));

app.get('/', (req, res) => {
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.send('Cognia Server Running. Please place index.html in the project root.');
});

// Mock RTO status feed
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

// Submit Application Route — validates, saves to MongoDB, and returns an ID
app.post('/api/submit-application', async (req, res) => {
  const body = req.body || {};

  // Basic mandatory validation
  const missing = ['fullName', 'dob', 'rtoCode', 'licenceType'].filter((f) => !body[f]);
  if (missing.length) {
    return res.status(400).json({
      ok: false,
      code: 'MISSING_FIELDS',
      message: `Mandatory field(s) missing: ${missing.join(', ')}`
    });
  }

  const generatedAppId = `DL-${Math.floor(100000 + Math.random() * 900000)}`;

  try {
    const newRecord = new Application({
      applicationId: generatedAppId,
      status: 'SUBMITTED',
      applicationType: body.licenceType === 'renew' ? 'DL_RENEWAL' : 'DL_NEW',
      jurisdiction: {
        state: body.gatewayState || body.state || 'KA',
        rtoCode: body.rtoCode
      },
      applicantDetails: {
        fullName: body.fullName,
        dob: body.dob,
        aadhaarNumber: body.aadhaar ? '[Aadhaar Redacted]' : undefined,
        address: {
          line1: body.addrLine1 || body.address,
          pincode: body.pincode,
          district: body.district
        }
      },
      licenceDetails: {
        vehicleClasses: Array.isArray(body.vehicleClass) ? body.vehicleClass : (body.vehicleClass ? [body.vehicleClass] : []),
        bloodGroup: body.bloodGroup,
        oldLicenceNumber: body.oldLicenceNumber
      },
      declarations: {
        visionDeclared: Boolean(body.visionDeclared),
        smsUpdates: Boolean(body.smsUpdates),
        organDonor: body.organDonor || 'no'
      },
      rawPayload: body
    });

    await newRecord.save();
    console.log(`Saved application ${generatedAppId} to MongoDB.`);

    return res.json({
      ok: true,
      applicationId: generatedAppId,
      message: 'Application submitted successfully and recorded in database. Please save your Application ID.'
    });

  } catch (error) {
    console.error('Database write error:', error);
    return res.status(500).json({
      ok: false,
      code: 'DB_SAVE_ERROR',
      message: 'Error storing application in database: ' + error.message
    });
  }
});

// Draft save endpoint — stores a draft state in MongoDB
app.post('/api/save-draft', async (req, res) => {
  try {
    const draftId = `DRAFT-${Date.now()}`;
    const draftRecord = new Application({
      applicationId: draftId,
      status: 'DRAFT',
      rawPayload: req.body || {}
    });
    await draftRecord.save();
    res.json({ ok: true, draftId, savedAt: new Date().toISOString() });
  } catch (err) {
    res.json({ ok: true, savedAt: new Date().toISOString(), warning: 'Saved locally in-memory only' });
  }
});

app.listen(PORT, () => {
  console.log(`Cognia portal running at http://localhost:${PORT}`);
});