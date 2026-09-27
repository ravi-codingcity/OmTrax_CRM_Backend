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

// Maximum documents in one submission (13 slots + a little headroom)
const MAX_FILES = 16;

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
    // One upload covers either proof of incorporation or the proprietor's
    // Aadhaar, depending on how the vendor is constituted. Mandatory.
    { field: 'cinAadhaar', docType: 'cin_aadhaar', label: 'CIN / Aadhaar Card', required: true },
    { field: 'msmeCertificate', docType: 'msme_certificate', label: 'MSME Certificate', required: false },
    { field: 'balanceSheet', docType: 'balance_sheet', label: 'Balance Sheet', required: false },
    { field: 'profitLoss', docType: 'profit_loss', label: 'Profit & Loss (P&L) Statement', required: false },
    { field: 'agreementUpload', docType: 'agreement', label: 'Agreement', required: false },
    // PF and ESI are collected as documents rather than typed numbers
    { field: 'pfDocument', docType: 'pf_document', label: 'PF Document', required: false },
    { field: 'esiDocument', docType: 'esi_document', label: 'ESI Document', required: false },
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

// Anything without a recognised type is treated as Purchase, matching the rest
// of the codebase. Declared here because documentsForType runs before the
// KYC_FORM_CONFIG block below.
const DEFAULT_KYC_TYPE_FOR_DOCS = 'purchase';

/**
 * The documents a given form asks for.
 *
 * The TDS declaration is a transporter document, so it belongs to the
 * Operations workflow only — the Purchase form does not offer it.
 */
const DOCS_EXCLUDED_BY_TYPE = {
    purchase: ['tdsDeclaration'],
    operations: [],
};

const documentsForType = (kycType) => {
    const excluded = DOCS_EXCLUDED_BY_TYPE[kycType]
        || DOCS_EXCLUDED_BY_TYPE[DEFAULT_KYC_TYPE_FOR_DOCS];
    if (!excluded.length) return KYC_DOCUMENTS;
    return KYC_DOCUMENTS.filter((d) => !excluded.includes(d.field));
};

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
    pf_document: 'PF Document',
    esi_document: 'ESI Document',
    // Collected separately before they were combined into cin_aadhaar
    aadhaar_card: 'Aadhaar Card',
    other: 'Other Document',
});

// Schema enum: current types plus every legacy value, so old rows stay valid.
const DOC_TYPE_ENUM = [...new Set([
    ...KYC_DOCUMENTS.map((d) => d.docType),
    'bank_statement', 'incorporation_certificate', 'company_registration',
    'aadhaar_card', 'other',
])];

// The service whose presence reveals the vehicle count on the Operations form
const VEHICLE_SERVICE = 'Transportation';

// --- KYC workflow ----------------------------------------------------------

// `correction_required` — Finance sent a submitted KYC back to the department
//                         that owns it, to have specific details corrected.
// `correction_sent`     — that department generated a Correction KYC Link; the
//                         vendor has not resubmitted yet. Their resubmission
//                         returns the KYC to `submitted` for Finance to review.
const KYC_STATUSES = [
    'not_sent', 'sent', 'submitted', 'under_review', 'approved', 'rejected',
    'correction_required', 'correction_sent',
];

// One correction round, from Finance's send-back to the vendor's resubmission.
//   requested      — Finance sent it back; no correction link yet
//   link_generated — the department generated a Correction KYC Link
//   submitted      — the vendor resubmitted the corrected details
//   superseded     — a full KYC link was generated instead, ending the round
const CORRECTION_ROUND_STATUSES = ['requested', 'link_generated', 'submitted', 'superseded'];

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

// --- Correction / resubmission ----------------------------------------------

/**
 * The details a Correction KYC Link can ask the vendor to resubmit, in the
 * order they appear on the KYC form. Each entry is one checkbox for the
 * department, covering the form inputs listed in `bodyFields` and/or one of the
 * form's lists (`list`). `when` limits an entry to the forms that collect it,
 * so the choices always match the form the vendor actually filled in.
 *
 * Documents are not listed here: every document slot the form offers
 * (documentsForType) is a correction choice of its own — see correctionFieldsFor.
 */
const CORRECTION_DETAIL_FIELDS = [
    { key: 'vendorName', label: 'Legal Name (as per PAN)', bodyFields: ['vendorName'] },
    { key: 'companyName', label: 'Vendor Company Name', bodyFields: ['companyName'] },
    { key: 'address', label: 'Company Address (City, State, Pincode)', bodyFields: ['address', 'city', 'state', 'pincode'] },
    { key: 'contactDetails', label: 'Contact Details (Contact Person, Email, Phone)', bodyFields: ['contactPerson', 'email', 'phone'] },
    { key: 'gstNumber', label: 'GST Number / URP', bodyFields: ['gstNumber'] },
    { key: 'otherStateGst', label: 'Other State GST Details', list: 'otherStateGst' },
    { key: 'panNumber', label: 'PAN Number', bodyFields: ['panNumber'] },
    { key: 'companySize', label: 'Company Size', bodyFields: ['companySize'] },
    { key: 'shopEstablishment', label: 'Shop Establishment Number', bodyFields: ['shopEstablishmentNumber'] },
    { key: 'serviceLocations', label: 'Service Locations', list: 'serviceLocations' },
    {
        key: 'materials', label: 'Material Details', list: 'materials',
        when: (cfg) => cfg.collectsMaterials,
    },
    {
        // The vehicle count belongs with the services it depends on
        key: 'services',
        label: (cfg) => (cfg.collectsVehicles ? `${cfg.servicesLabel} (and Number of Vehicles)` : cfg.servicesLabel),
        list: 'services',
        bodyFields: (cfg) => (cfg.collectsVehicles ? ['numberOfVehicles'] : []),
        when: (cfg) => cfg.collectsServices,
    },
    { key: 'bankDetails', label: 'Bank Details', bodyFields: ['bankName', 'accountHolderName', 'accountNumber', 'ifscCode'] },
    { key: 'additionalInfo', label: 'Additional Information', bodyFields: ['kycAdditionalInfo'] },
];

/**
 * Every correction choice for one KYC form type: the details it collects, then
 * each document slot it offers. Derived from the same configuration the form
 * itself is built from, so the two cannot drift apart.
 *
 * @returns {Array<{ key, label, type: 'field'|'document', bodyFields?, list?, docType?, isTemplate? }>}
 */
const correctionFieldsFor = (kycType) => {
    const cfg = formConfig(kycType);
    const details = CORRECTION_DETAIL_FIELDS
        .filter((f) => !f.when || f.when(cfg))
        .map((f) => ({
            key: f.key,
            label: typeof f.label === 'function' ? f.label(cfg) : f.label,
            type: 'field',
            bodyFields: typeof f.bodyFields === 'function' ? f.bodyFields(cfg) : (f.bodyFields || []),
            list: f.list || null,
        }));
    const documents = documentsForType(cfg.kycType).map((d) => ({
        key: d.field,
        label: d.label,
        type: 'document',
        docType: d.docType,
        isTemplate: !!d.isTemplate,
        requiresGst: !!d.requiresGst,
    }));
    return [...details, ...documents];
};

// A remark or note long enough to be useful, short enough to stay a note
const MAX_CORRECTION_TEXT = 1000;

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
    VEHICLE_SERVICE,
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
    CORRECTION_ROUND_STATUSES,
    CORRECTION_DETAIL_FIELDS,
    correctionFieldsFor,
    MAX_CORRECTION_TEXT,
    TOKEN_TTL_DAYS,
    SIGNED_URL_TTL_SECONDS,
    GST_RX,
    PAN_RX,
    IFSC_RX,
    EMAIL_RX,
    PHONE_RX,
};
