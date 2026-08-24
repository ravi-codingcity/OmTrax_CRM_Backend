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

const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_TYPES);
const ALLOWED_EXTENSIONS = [...new Set(Object.values(ALLOWED_TYPES).flatMap((t) => t.ext))];
const ALLOWED_LABEL = 'JPG, JPEG, PDF, XLS or XLSX';

// Maximum documents in one submission (7 slots + a little headroom)
const MAX_FILES = 10;

// --- Document types --------------------------------------------------------

/**
 * The five documents a vendor is asked for. `field` is the multipart field name
 * the frontend uses; `docType` is what gets persisted.
 *
 * Legacy docTypes from the first release are kept in DOC_TYPE_ENUM so existing
 * records stay valid, even though they are no longer collected.
 */
const KYC_DOCUMENTS = [
    { field: 'panCard', docType: 'pan_card', label: 'PAN Card', required: true },
    // Required only when the vendor supplies a real GST number. A vendor who
    // enters URP is not GST registered, so there is no certificate to give.
    { field: 'gstCertificate', docType: 'gst_certificate', label: 'GST Certificate', required: true, requiresGst: true },
    { field: 'cancelledCheque', docType: 'cancelled_cheque', label: 'Cancelled Cheque', required: true },
    { field: 'companyRegistration', docType: 'company_registration', label: 'Company Registration Document', required: true },
    { field: 'aadhaarCard', docType: 'aadhaar_card', label: 'Aadhaar Card', required: false },
    { field: 'msmeCertificate', docType: 'msme_certificate', label: 'MSME Certificate', required: false },
    { field: 'agreementUpload', docType: 'agreement', label: 'Agreement', required: false },
];

/**
 * Which documents a submission must carry, given what was entered for GST.
 * `URP` means unregistered, so the GST certificate drops out of the list.
 */
const requiredDocumentsFor = (gstValue) => {
    const unregistered = isUrp(gstValue);
    return KYC_DOCUMENTS.filter((d) => d.required && !(d.requiresGst && unregistered));
};

const DOC_FIELD_TO_TYPE = KYC_DOCUMENTS.reduce((acc, d) => {
    acc[d.field] = d.docType;
    return acc;
}, {});

const DOC_TYPE_LABELS = KYC_DOCUMENTS.reduce((acc, d) => {
    acc[d.docType] = d.label;
    return acc;
}, {
    // Legacy labels — records created before this release may still use these
    bank_statement: 'Bank Statement',
    incorporation_certificate: 'Certificate of Incorporation',
    msme_certificate: 'MSME / Udyam Certificate',
    other: 'Other Document',
});

// Schema enum: current types plus every legacy value, so old rows stay valid.
const DOC_TYPE_ENUM = [
    ...KYC_DOCUMENTS.map((d) => d.docType),
    'bank_statement', 'incorporation_certificate', 'other',
];

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
 * Non-material services a vendor may offer. Fixed list — the Purchase
 * Department's item master supplies the material options separately.
 */
const OTHER_SERVICES = [
    'AMC',
    'Furniture & Fixtures',
    'Insurance',
    'Labour',
    'Office Equipment',
    'Packing Material',
    'Postage & Courier',
    'Printing & Stationary',
    'Professional',
    'Relocation Charges',
    'Rent / Lease',
    'Security',
    'Tools and Equipment',
    'Tour & Travel',
    'Transportation',
    'Repair & Maintenance',
    'Air & Sea Freight and Custom Clearance',
];

const GST_RX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const IFSC_RX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RX = /^[0-9]{10}$/;

module.exports = {
    URP_VALUE,
    isUrp,
    OTHER_SERVICES,
    requiredDocumentsFor,
    MAX_FILE_BYTES,
    MAX_FILE_MB,
    MAX_FILES,
    ALLOWED_TYPES,
    ALLOWED_MIME_TYPES,
    ALLOWED_EXTENSIONS,
    ALLOWED_LABEL,
    KYC_DOCUMENTS,
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
