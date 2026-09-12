const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
  applicationId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  status: { 
    type: String, 
    enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'], 
    default: 'SUBMITTED' 
  },
  applicationType: { 
    type: String, 
    default: 'DL_NEW'
  },
  jurisdiction: {
    state: { type: String },
    rtoCode: { type: String }
  },
  applicantDetails: {
    fullName: { type: String },
    dob: { type: String },
    aadhaarNumber: { type: String },
    address: {
      line1: String,
      pincode: String,
      district: String
    }
  },
  licenceDetails: {
    vehicleClasses: [String],
    bloodGroup: String,
    oldLicenceNumber: String
  },
  declarations: {
    visionDeclared: { type: Boolean, default: false },
    smsUpdates: { type: Boolean, default: true },
    organDonor: { type: String, default: 'no' }
  },
  rawPayload: { type: Object }
}, { timestamps: true });

// This specific line is what prevents the "not a constructor" error
module.exports = mongoose.model('Application', applicationSchema);