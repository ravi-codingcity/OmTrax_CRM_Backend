const mongoose = require('mongoose');
const crypto = require('crypto');
const {
    DOC_TYPE_ENUM,
    KYC_STATUSES: STATUS_LIST,
    KYC_TYPES: KYC_TYPE_LIST,
    CORRECTION_ROUND_STATUSES,
} = require('../constants/kycConstants');

// Shared vendor register for the Purchase and Finance departments.
//
// Deliberately SEPARATE from the existing `Supplier` model: Supplier is a thin
// autocomplete master for purchase entries and is left untouched so existing
// Purchase functionality keeps working exactly as before. Vendor is the richer
// record that carries KYC, banking details and the Finance approval workflow.

// One uploaded KYC document. The file lives in Cloudinary; Mongo stores the
// URL and public_id so it can be displayed and (if ever needed) deleted.
const kycDocumentSchema = new mongoose.Schema({
    docType: {
        type: String,
        enum: DOC_TYPE_ENUM,
        default: 'other'
    },
    // --- Metadata kept for every stored document ---
    originalName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    format: { type: String, trim: true },
    bytes: { type: Number },
    // --- Cloudinary references (the file itself is never stored in Mongo) ---
    url: { type: String, trim: true, required: true },
    publicId: { type: String, trim: true, required: true },
    // Needed on every later read/delete — Cloudinary requires the matching
    // resource type, and it differs between PDFs/images and Excel files.
    resourceType: { type: String, enum: ['image', 'raw', 'video'], default: 'image' },
    uploadedAt: { type: Date, default: Date.now }
}, { _id: true });

// One material a vendor supplies, chosen from the Purchase Department's item
// master. An object rather than a bare string so extra fields can be added
// later without a migration.
const materialSchema = new mongoose.Schema({
    materialName: { type: String, required: true, trim: true },
    // Legacy free-text fields — no longer collected, retained for old records
    description: { type: String, trim: true },
    unit: { type: String, trim: true },
    estimatedRate: { type: Number, min: 0 },
    addedAt: { type: Date, default: Date.now }
}, { _id: true });

// One place the vendor operates: a state, and optionally the cities within it.
//
// Structured rather than a flat string so Operations and Finance can query by
// state or city later. `cities` may be empty — a vendor covering a whole state
// is not required to name any.
const serviceLocationSchema = new mongoose.Schema({
    state: { type: String, required: true, trim: true, index: true },
    // Free text on purpose: the dropdown is a convenience, and a vendor
    // operating somewhere not listed types the name in.
    cities: [{ type: String, trim: true }],
}, { _id: true });

// One additional state registration: the state, and the GST number held there.
// Only populated when the vendor says they are registered in other states.
const otherStateGstSchema = new mongoose.Schema({
    state: { type: String, required: true, trim: true },
    gstNumber: { type: String, required: true, trim: true, uppercase: true },
}, { _id: true });

// One non-material service, chosen from the fixed OTHER_SERVICES list.
// Kept separate from materials so Purchase and Finance can read each on its own.
const serviceSchema = new mongoose.Schema({
    serviceName: { type: String, required: true, trim: true },
    addedAt: { type: Date, default: Date.now }
}, { _id: true });

// Append-only audit trail of everything that happens to this vendor's KYC.
const kycHistorySchema = new mongoose.Schema({
    action: {
        type: String,
        enum: ['created', 'link_generated', 'link_sent', 'submitted',
            'under_review', 'approved', 'rejected', 'reset', 'updated',
            // Correction / resubmission workflow
            'correction_requested', 'correction_link_generated', 'correction_submitted'],
        required: true
    },
    at: { type: Date, default: Date.now },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, trim: true },
    byRole: { type: String, trim: true },
    fromStatus: { type: String, trim: true },
    toStatus: { type: String, trim: true },
    remarks: { type: String, trim: true }
}, { _id: false });

// One correction round: Finance sends a submitted KYC back, the owning
// department generates a Correction KYC Link naming the details to fix, and the
// vendor resubmits only those. Kept as a list so every round stays on record;
// the last entry is the current one.
const kycCorrectionSchema = new mongoose.Schema({
    round: { type: Number, required: true },
    status: { type: String, enum: CORRECTION_ROUND_STATUSES, required: true },
    // Finance's send-back
    remarks: { type: String, trim: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedByName: { type: String, trim: true },
    requestedAt: { type: Date },
    // The department's Correction KYC Link: the keys of the details and
    // documents selected (see correctionFieldsFor) and an optional note that
    // the vendor sees on the form
    fields: { type: [String], default: undefined },
    vendorNote: { type: String, trim: true },
    linkGeneratedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    linkGeneratedByName: { type: String, trim: true },
    linkGeneratedAt: { type: Date },
    // The vendor's resubmission
    submittedAt: { type: Date },
    // What the corrected uploads replaced — names only; the replaced files are
    // removed from Cloudinary once the corrected record is saved
    replacedDocuments: {
        type: [{
            _id: false,
            docType: { type: String, trim: true },
            originalName: { type: String, trim: true },
            uploadedAt: { type: Date },
        }],
        default: undefined,
    },
}, { _id: true });

const KYC_STATUSES = STATUS_LIST;

const vendorSchema = new mongoose.Schema({
    // --- Identity (entered by Purchase/Finance when creating the vendor) ---
    vendorName: {
        type: String,
        required: [true, 'Vendor name is required'],
        trim: true,
        index: true
    },
    // True while `vendorName` holds a temporary, internal name: the one the
    // team entered when generating the KYC link (or, on links generated before
    // that step existed, an "Awaiting KYC ..." id). The vendor is never shown
    // it — their KYC form keeps the name field blank — and the Legal Name they
    // submit replaces it and clears this flag.
    nameIsPlaceholder: { type: Boolean, default: false },
    // The vendor name the Purchase / Operations team entered when generating
    // the KYC link. Kept after the vendor's submitted name replaces
    // `vendorName`, so the request can still be traced to what the team
    // called it. Empty on vendors added manually or linked before this existed.
    kycRequestName: { type: String, trim: true, maxlength: 150 },
    companyName: { type: String, trim: true },
    contactPerson: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    category: { type: String, trim: true },

    // --- Address ---
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },

    // --- Statutory (usually completed by the vendor via the KYC form) ---
    gstNumber: { type: String, trim: true, uppercase: true },
    panNumber: { type: String, trim: true, uppercase: true },
    // A vendor registered in more than one state lists the others here. The
    // primary registration stays in `gstNumber`; this array is only the extras.
    otherStateGst: [otherStateGstSchema],
    // All optional — a vendor may legitimately have none of these.
    esiNumber: { type: String, trim: true },
    pfNumber: { type: String, trim: true },
    shopEstablishmentNumber: { type: String, trim: true },
    // No longer collected on either form; kept so existing records keep theirs
    iecCode: { type: String, trim: true, uppercase: true },
    companySize: { type: String, trim: true },
    // Where the vendor provides services: many states, each with optional
    // cities. This is the field to read.
    serviceLocations: [serviceLocationSchema],
    // Legacy single-state value from before multi-location support. Kept so
    // existing records keep their data and nothing that reads it breaks; new
    // submissions populate serviceLocations above.
    serviceLocation: { type: String, trim: true },

    // --- Banking (completed via the KYC form) ---
    bankName: { type: String, trim: true },
    accountHolderName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true, uppercase: true },
    paymentTerms: { type: String, trim: true },

    // --- KYC workflow ---
    // not_sent -> sent -> submitted -> under_review -> approved | rejected
    kycStatus: {
        type: String,
        enum: KYC_STATUSES,
        default: 'not_sent',
        index: true
    },
    // WHICH FORM the vendor filled in. Distinct from kycSource below: Finance
    // may generate either form, so the generating department does not identify
    // the workflow. Records created before Operations existed are Purchase.
    kycType: {
        type: String,
        enum: KYC_TYPE_LIST,
        default: 'purchase',
        index: true
    },
    // Which department generated the KYC link the vendor used.
    kycSource: {
        type: String,
        enum: ['purchase', 'finance', 'operations', null],
        default: null
    },
    kycSourceUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    kycSourceUserName: { type: String, trim: true },

    // Secure single-vendor token behind the public KYC form URL.
    // Sparse so many vendors can sit at null without violating uniqueness.
    kycToken: { type: String, trim: true, unique: true, sparse: true, index: true },
    // The exact public URL that was shared with the vendor. Stored rather than
    // rebuilt on demand so the link survives a change of PUBLIC_APP_URL, and so
    // it can be copied again later by anyone authorised — the token itself is
    // never returned by the API.
    kycLinkUrl: { type: String, trim: true },
    // What the current link opens. 'correction' marks a Correction KYC Link —
    // the form shows only the selected details and documents. Unset on every
    // link generated before corrections existed, which are all full forms.
    kycLinkType: { type: String, enum: ['standard', 'correction'] },
    kycTokenGeneratedAt: { type: Date },
    kycTokenExpiresAt: { type: Date },
    kycLinkSentAt: { type: Date },
    kycSubmittedAt: { type: Date },

    kycDocuments: [kycDocumentSchema],

    // What this vendor supplies. Materials come from the Purchase Department's
    // item master; services from the fixed list. A vendor may offer either, both,
    // or several of each — hence two arrays rather than one blob of text.
    materials: [materialSchema],
    services: [serviceSchema],

    // Operations KYC only — how many vehicles the vendor runs.
    numberOfVehicles: { type: Number, min: 0 },

    // Anything the vendor typed that has no dedicated column
    kycAdditionalInfo: { type: String, trim: true },

    // --- Finance review (Finance department only) ---
    financeReview: {
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reviewedByName: { type: String, trim: true },
        reviewedAt: { type: Date },
        decision: { type: String, enum: ['approved', 'rejected', null], default: null },
        remarks: { type: String, trim: true }
    },

    kycHistory: [kycHistorySchema],

    // Correction rounds, oldest first. No default, so records that have never
    // been sent back are left exactly as they are.
    kycCorrections: { type: [kycCorrectionSchema], default: undefined },

    // --- Ownership ---
    // Which department created the vendor. NOT used to restrict visibility —
    // vendors are shared between Purchase, Operations and Finance by design.
    // Visibility is decided by role and by kycType (see canAccessKycType).
    department: {
        type: String,
        enum: ['purchase', 'finance', 'operations'],
        default: 'purchase',
        index: true
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

vendorSchema.index({ kycStatus: 1, createdAt: -1 });
vendorSchema.index({ vendorName: 1, companyName: 1 });

// Generate a fresh, unguessable KYC token. 32 random bytes -> 64 hex chars.
vendorSchema.statics.generateToken = function () {
    return crypto.randomBytes(32).toString('hex');
};

// True while the token can still be used to submit the form.
vendorSchema.methods.isTokenUsable = function () {
    if (!this.kycToken) return false;
    if (this.kycTokenExpiresAt && this.kycTokenExpiresAt < new Date()) return false;
    // Once submitted, the form locks until a new request is generated.
    if (['sent', 'not_sent'].includes(this.kycStatus)) return true;
    // A Correction KYC Link opens only while its correction is outstanding
    return this.kycStatus === 'correction_sent' && this.kycLinkType === 'correction';
};

// The correction round in progress, or null. A round is in progress from
// Finance's send-back until the vendor resubmits (or a full link replaces it).
vendorSchema.methods.openCorrection = function () {
    const rounds = this.kycCorrections || [];
    const last = rounds[rounds.length - 1];
    return last && ['requested', 'link_generated'].includes(last.status) ? last : null;
};

// Append one line to the audit trail.
vendorSchema.methods.logKyc = function (action, actor, extra = {}) {
    this.kycHistory = this.kycHistory || [];
    this.kycHistory.push({
        action,
        at: new Date(),
        byUser: actor?.id || actor?._id,
        byName: actor?.name,
        byRole: actor?.role,
        ...extra
    });
};

// Never expose the raw token or full bank account number in list payloads.
vendorSchema.methods.toSafeJSON = function () {
    const v = this.toObject();
    // The token is the credential for the public form and is never returned.
    // `hasKycLink` lets the UI offer "Copy KYC Link" without it; the link
    // itself comes from GET /api/vendors/:id/kyc-link, which checks permission.
    v.hasKycLink = !!(v.kycLinkUrl || v.kycToken);
    delete v.kycToken;
    delete v.kycLinkUrl;
    return v;
};

module.exports = mongoose.model('Vendor', vendorSchema);
module.exports.KYC_STATUSES = KYC_STATUSES;
