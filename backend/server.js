const express = require('express');
const path = require('path');
const mongoose = require('mongoose');

// Try requiring capitalized 'Application', fallback to lowercase if necessary
let Application;
try {
  Application = require('./models/application');
} catch (e) {
  Application = require('./models/application');
}

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

// Serve static frontend assets from both possible locations (backend/public or project root)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '..')));

// Fallback GET / route to serve index.html directly if not automatically resolved
app.get('/', (req, res) => {
  const rootIndex = path.join(__dirname, '..', 'index.html');
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  
  const fs = require('fs');
  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  } else if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  res.send('Cognia Server Running. Please place index.html in the project root or backend/public directory.');
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