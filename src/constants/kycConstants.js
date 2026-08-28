/**
 * Vendor KYC constants — the single source of truth for document types, file
 * restrictions and KYC statuses. The frontend mirrors these in
 * src/config/kyc.js; if you change a limit here, change it there too.
 */

// --- File restrictions -----------------------------------------------------

// Each individual document must be under 1 MB.
const MAX_FILE_BYTES = 1 * 1024 * 1024;
const MAX_FILE_MB = 1;

// Allowed formats: JPG/JPEG, PDF, and Excel (.xls / .xlsx) only.
// Keyed by mime type; `ext` is used as a second line of defence because some
// browsers report Excel files with a generic or vendor-specific mime type.
const ALLOWED_TYPES = {
    'image/jpeg': { ext: ['jpg', 'jpeg'], label: 'JPG' },
    'image/jpg': { ext: ['jpg', 'jpeg'], label: 'JPG' },
    'application/pdf': { ext: ['pdf'], label: 'PDF' },
    'application/vnd.ms-excel': { ext: ['xls'], label: 'Excel' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'], label: 'Excel' },
    // Some clients send Excel as a generic binary stream; the extension check
    // below is what actually accepts or rejects those.
    'application/octet-stream': { ext: ['xls', 'xlsx'], label: 'Excel' },
};

// Word formats, accepted ONLY on the slots that hand the vendor a .docx
// template to fill in. Keeping these off the general set stops a Word file
// being uploaded as, say, a PAN card.
const WORD_TYPES = {
    'application/msword': { ext: ['doc'], label: 'DOC' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], label: 'DOCX' },
    // Some browsers send a generic stream for .doc/.docx; the extension check
    // below is what actually accepts or rejects those.
    'application/octet-stream': { ext: ['doc', 'docx'], label: 'Word' },
};

const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_TYPES);
const ALLOWED_EXTENSIONS = [...new Set(Object.values(ALLOWED_TYPES).flatMap((t) => t.ext))];
const ALLOWED_LABEL = 'JPG, JPEG, PDF, XLS or XLSX';

// Maximum documents in one submission (11 slots + a little headroom)
const MAX_FILES = 14;

// --- Document types --------------------------------------------------------

/**
 * The documents a vendor is asked for. `field` is the multipart field name the
 * frontend uses; `docType` is what gets persisted.
 *
 * Legacy docTypes from earlier releases are kept in DOC_TYPE_ENUM so existing
 * records stay valid, even though they are no longer collected.
 */
const KYC_DOCUMENTS = [
    { field: 'panCard', docType: 'pan_card', label: 'PAN Card', required: true },
    // Required only when the vendor supplies a real GST number. A vendor who
    // enters URP is not GST registered, so there is no certificate to give.
    { field: 'gstCertificate', docType: 'gst_certificate', label: 'GST Certificate', required: true, requiresGst: true },
    { field: 'cancelledCheque', docType: 'cancelled_cheque', label: 'Cancelled Cheque', required: true },
    { field: 'incorporationCertificate', docType: 'incorporation_certificate', label: 'Incorporation Certificate (CIN)', required: false },
    { field: 'aadhaarCard', docType: 'aadhaar_card', label: 'Aadhaar Card', required: false },
    { field: 'msmeCertificate', docType: 'msme_certificate', label: 'MSME Certificate', required: false },
    { field: 'balanceSheet', docType: 'balance_sheet', label: 'Balance Sheet', required: false },
    { field: 'profitLoss', docType: 'profit_loss', label: 'Profit & Loss (P&L) Statement', required: false },
    { field: 'agreementUpload', docType: 'agreement', label: 'Agreement', required: false },
    // Template documents: the vendor downloads a .docx, fills it in offline and
    // uploads the completed copy. Optional, and they also accept the standard
    // formats so a signed scan can be returned as a PDF or photo.
    {
        field: 'generalAgreement', docType: 'general_agreement',
        label: 'General Agreement Form', required: false,
        isTemplate: true, acceptsWord: true,
    },
    {
        field: 'tdsDeclaration', docType: 'tds_declaration',
        label: 'TDS Declaration – Non-Deduction of TDS (Transporter), Tax Year 2026-27',
        required: false, isTemplate: true, acceptsWord: true,
    },
];

// Which slots additionally accept .doc / .docx
const WORD_FIELDS = new Set(KYC_DOCUMENTS.filter((d) => d.acceptsWord).map((d) => d.field));

/**
 * The accepted formats for one document slot. Template slots take Word files on
 * top of the standard set; every other slot keeps exactly the rules it had.
 */
const allowedTypesFor = (field) =>
    (WORD_FIELDS.has(field) ? { ...ALLOWED_TYPES, ...WORD_TYPES } : ALLOWED_TYPES);

const allowedExtensionsFor = (field) => [...new Set(
    Object.values(allowedTypesFor(field)).flatMap((t) => t.ext)
)];

const allowedLabelFor = (field) =>
    (WORD_FIELDS.has(field) ? `${ALLOWED_LABEL}, DOC or DOCX` : ALLOWED_LABEL);

// `company_registration` is no longer collected on either form. Existing
// records that carry one still resolve a label and stay schema-valid via
// DOC_TYPE_LABELS / DOC_TYPE_ENUM below.

/**
 * Both KYC forms currently ask for the same documents. The two workflows differ
 * in their FIELDS, not their uploads (Purchase collects materials, Operations
 * collects services and a vehicle count) — see KYC_FORM_CONFIG.
 *
 * Kept as a function so a future form can diverge without touching callers.
 */
const documentsForType = () => KYC_DOCUMENTS;

/**
 * Which documents a submission must carry, given what was entered for GST and
 * which form is being filled in.
 *
 * `URP` means the vendor is not registered, so the GST certificate
 * (`requiresGst`) drops out of the required list — the form hides it outright.
 * An `optionalWhenUrp` document would stay on offer but stop being mandatory.
 */
const requiredDocumentsFor = (gstValue, kycType) => {
    const unregistered = isUrp(gstValue);
    return documentsForType(kycType).filter(
        (d) => d.required && !((d.requiresGst || d.optionalWhenUrp) && unregistered)
    );
};

const DOC_FIELD_TO_TYPE = KYC_DOCUMENTS.reduce((acc, d) => {
    acc[d.field] = d.docType;
    return acc;
}, {});

const DOC_TYPE_LABELS = KYC_DOCUMENTS.reduce((acc, d) => {
    acc[d.docType] = d.label;
    return acc;
}, {
    // Legacy labels — records created before this release may still use these.
    // Anything also present in KYC_DOCUMENTS is overwritten by the loop above.
    bank_statement: 'Bank Statement',
    incorporation_certificate: 'Certificate of Incorporation',
    msme_certificate: 'MSME / Udyam Certificate',
    // No longer collected on either form, but old submissions still carry one
    company_registration: 'Company Registration Document',
    other: 'Other Document',
});

// Schema enum: current types plus every legacy value, so old rows stay valid.
const DOC_TYPE_ENUM = [...new Set([
    ...KYC_DOCUMENTS.map((d) => d.docType),
    'bank_statement', 'incorporation_certificate', 'company_registration', 'other',
])];

// --- KYC workflow ----------------------------------------------------------

const KYC_STATUSES = ['not_sent', 'sent', 'submitted', 'under_review', 'approved', 'rejected'];

// How long a generated KYC link stays usable
const TOKEN_TTL_DAYS = 30;

// How long a signed document URL stays valid once Purchase/Finance requests it
const SIGNED_URL_TTL_SECONDS = 5 * 60;

// --- Field validation patterns ---------------------------------------------

// A vendor who is not GST registered enters this instead of a GST number.
// URP = Unregistered Proprietorship.
const URP_VALUE = 'URP';
const isUrp = (value) => String(value ?? '').trim().toUpperCase() === URP_VALUE;

/**
 * Services a vendor may offer, collected by the Operations form. The Purchase
 * Department's item master supplies the material options separately.
 *
 * Order is meaningful: the four most commonly picked Operations services lead
 * the list so the vendor sees them first, and the rest follow alphabetically.
 * Nothing has been removed.
 */
const PRIORITY_SERVICES = [
    'Transportation',
    'Loading and Unloading',
    'Labour',
    'Handy Man',
];

const OTHER_SERVICES = [
    ...PRIORITY_SERVICES,
    'AMC',
    'Air & Sea Freight and Custom Clearance',
    'Furniture & Fixtures',
    'Insurance',
    'Office Equipment',
    'Packing Material',
    'Postage & Courier',
    'Printing & Stationary',
    'Professional',
    'Relocation Charges',
    'Rent / Lease',
    'Repair & Maintenance',
    'Security',
    'Tools and Equipment',
    'Tour & Travel',
];

// --- Service location ------------------------------------------------------

// States, their cities and the submission bounds live in indiaLocations.js —
// shared reference data rather than a second copy of the same list.
const {
    INDIAN_STATES, CITIES_BY_STATE, isIndianState, citiesForState,
    MAX_SERVICE_STATES, MAX_CITIES_PER_STATE, MAX_CITY_NAME_LENGTH,
} = require('./indiaLocations');

// Employee-count bands offered for Company Size.
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

// How many other-state GST rows one vendor may submit. Generous, but bounded so
// a crafted request cannot post thousands of entries.
const MAX_OTHER_STATE_GST = 36;

// --- Per-form configuration ------------------------------------------------

/**
 * What each KYC workflow collects. The two forms share every document and every
 * statutory field; they differ only in what the vendor is asked to supply:
 *
 *   purchase   — Materials (from the Purchase item master). No Other Services.
 *   operations — Other Services and a vehicle count. No Materials.
 */
const KYC_FORM_CONFIG = {
    purchase: {
        kycType: 'purchase',
        label: 'Purchase Department KYC',
        departmentLabel: 'Purchase Department',
        collectsMaterials: true,
        collectsServices: false,
        collectsVehicles: false,
        servicesLabel: 'Other Services',
    },
    operations: {
        kycType: 'operations',
        label: 'Operations Department KYC',
        departmentLabel: 'Operations Department',
        collectsMaterials: false,
        collectsServices: true,
        collectsVehicles: true,
        // Operations calls these Operation Services rather than Other Services
        servicesLabel: 'Operation Services',
    },
};

const KYC_TYPES = Object.keys(KYC_FORM_CONFIG);
const DEFAULT_KYC_TYPE = 'purchase';
const isValidKycType = (t) => KYC_TYPES.includes(t);
// Unknown/missing type falls back to Purchase, which is what every record
// created before this release was.
const formConfig = (kycType) => KYC_FORM_CONFIG[kycType] || KYC_FORM_CONFIG[DEFAULT_KYC_TYPE];

const GST_RX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const IFSC_RX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RX = /^[0-9]{10}$/;

module.exports = {
    URP_VALUE,
    isUrp,
    OTHER_SERVICES,
    PRIORITY_SERVICES,
    INDIAN_STATES,
    CITIES_BY_STATE,
    isIndianState,
    citiesForState,
    MAX_SERVICE_STATES,
    MAX_CITIES_PER_STATE,
    MAX_CITY_NAME_LENGTH,
    COMPANY_SIZES,
    MAX_OTHER_STATE_GST,
    KYC_FORM_CONFIG,
    KYC_TYPES,
    DEFAULT_KYC_TYPE,
    isValidKycType,
    formConfig,
    documentsForType,
    requiredDocumentsFor,
    MAX_FILE_BYTES,
    MAX_FILE_MB,
    MAX_FILES,
    ALLOWED_TYPES,
    ALLOWED_MIME_TYPES,
    ALLOWED_EXTENSIONS,
    ALLOWED_LABEL,
    KYC_DOCUMENTS,
    WORD_TYPES,
    WORD_FIELDS,
    allowedTypesFor,
    allowedExtensionsFor,
    allowedLabelFor,
    DOC_FIELD_TO_TYPE,
    DOC_TYPE_LABELS,
    DOC_TYPE_ENUM,
    KYC_STATUSES,
    TOKEN_TTL_DAYS,
    SIGNED_URL_TTL_SECONDS,
    GST_RX,
    PAN_RX,
    IFSC_RX,
    EMAIL_RX,
    PHONE_RX,
};
