/**
 * Vendor KYC validation.
 *
 * These checks are the authoritative ones. The frontend performs the same
 * validation for fast feedback, but a vendor calling the API directly — with
 * curl, Postman, or a modified page — is stopped here.
 */

const path = require('path');
const {
    MAX_FILE_BYTES, MAX_FILE_MB, MAX_FILES,
    ALLOWED_TYPES, ALLOWED_EXTENSIONS, ALLOWED_LABEL,
    DOC_FIELD_TO_TYPE, OTHER_SERVICES, URP_VALUE, isUrp, requiredDocumentsFor,
    GST_RX, PAN_RX, IFSC_RX, EMAIL_RX, PHONE_RX,
    isIndianState, COMPANY_SIZES, MAX_OTHER_STATE_GST,
} = require('../constants/kycConstants');

const clean = (v) => String(v ?? '').trim();

/**
 * Validate the text fields of a KYC submission.
 * @returns {string[]} human-readable problems; empty means valid
 */
const validateKycFields = (body = {}) => {
    const problems = [];

    // --- Vendor information ---
    if (!clean(body.vendorName)) problems.push('Legal Name (as per PAN) is required');
    if (!clean(body.companyName)) problems.push('Vendor Company Name is required');
    if (!clean(body.address)) problems.push('Company address is required');

    const email = clean(body.email);
    if (!email) problems.push('Email ID is required');
    else if (!EMAIL_RX.test(email)) problems.push('Enter a valid email address');

    const phone = clean(body.phone).replace(/\D/g, '');
    if (!phone) problems.push('Phone number is required');
    else if (!PHONE_RX.test(phone)) problems.push('Phone number must be 10 digits');

    // Either a valid GST number, or URP for a vendor who is not GST registered
    const gst = clean(body.gstNumber).toUpperCase();
    if (!gst) problems.push(`GST Number / URP is required — enter your GST number, or ${URP_VALUE} if you are not GST registered`);
    else if (!isUrp(gst) && !GST_RX.test(gst)) {
        problems.push(`Enter a valid GST number (e.g. 07AABCU9603R1ZM), or ${URP_VALUE} if you are not GST registered`);
    }

    const pan = clean(body.panNumber).toUpperCase();
    if (!pan) problems.push('PAN card number is required');
    else if (!PAN_RX.test(pan)) problems.push('PAN format looks incorrect (e.g. ABCDE1234F)');

    // --- Banking (optional here, but validated when supplied) ---
    const ifsc = clean(body.ifscCode).toUpperCase();
    if (ifsc && !IFSC_RX.test(ifsc)) problems.push('IFSC code format looks incorrect (e.g. HDFC0001234)');

    // --- Optional statutory details -----------------------------------------
    // ESI, PF, Shop Establishment and IEC are free-format across registrars, so
    // only a sane length is enforced. Service Location and Company Size come
    // from dropdowns, so an off-list value means a hand-crafted request.
    const location = clean(body.serviceLocation);
    if (location && !isIndianState(location)) {
        problems.push('Select a Service Location from the list of Indian States and Union Territories');
    }

    const size = clean(body.companySize);
    if (size && !COMPANY_SIZES.includes(size)) problems.push('Select a Company Size from the list');

    const iec = clean(body.iecCode);
    if (iec && !/^[A-Z0-9]{6,15}$/i.test(iec)) problems.push('IEC Code format looks incorrect');

    [['esiNumber', 'ESI Number'], ['pfNumber', 'PF Number'],
        ['shopEstablishmentNumber', 'Shop Establishment Number']].forEach(([f, label]) => {
        if (clean(body[f]).length > 40) problems.push(`${label} is too long`);
    });

    // Operations only, but harmless to validate whenever it is supplied
    const vehicles = clean(body.numberOfVehicles);
    if (vehicles) {
        const n = Number(vehicles);
        if (!Number.isInteger(n) || n < 0) problems.push('Number of Vehicles must be a whole number');
        else if (n > 100000) problems.push('Number of Vehicles looks too large');
    }

    return problems;
};

/**
 * Parse the "registered in other states too" list.
 *
 * Same transport as materials/services: a JSON string in multipart, or a real
 * array from a JSON client. Each row must name a state and a valid GST number,
 * and a state may only appear once.
 *
 * @returns {{ otherStateGst: Array, problems: string[] }}
 */
const parseOtherStateGst = (raw) => {
    const problems = [];
    let list = raw;

    if (typeof raw === 'string') {
        if (!raw.trim()) return { otherStateGst: [], problems };
        try {
            list = JSON.parse(raw);
        } catch {
            return { otherStateGst: [], problems: ['Other state GST list could not be read'] };
        }
    }

    if (list == null) return { otherStateGst: [], problems };
    if (!Array.isArray(list)) return { otherStateGst: [], problems: ['Other state GST list must be a list'] };
    if (list.length > MAX_OTHER_STATE_GST) {
        return { otherStateGst: [], problems: [`At most ${MAX_OTHER_STATE_GST} other state GST entries can be submitted`] };
    }

    const seen = new Set();
    const rows = [];
    list.forEach((row, i) => {
        const at = `Other state GST #${i + 1}`;
        const state = clean(row && (row.state ?? row.stateName));
        const gst = clean(row && (row.gstNumber ?? row.gst)).toUpperCase();

        // A wholly blank row is just an untouched input — skip it silently
        if (!state && !gst) return;

        if (!state) problems.push(`${at}: select a state`);
        else if (!isIndianState(state)) problems.push(`${at}: "${state}" is not a recognised state`);
        else if (seen.has(state)) problems.push(`${at}: ${state} is listed more than once`);

        if (!gst) problems.push(`${at}: enter the GST number`);
        else if (!GST_RX.test(gst)) problems.push(`${at}: "${gst}" is not a valid GST number`);

        if (state && gst && isIndianState(state) && GST_RX.test(gst) && !seen.has(state)) {
            seen.add(state);
            rows.push({ state, gstNumber: gst });
        }
    });

    return { otherStateGst: rows, problems };
};

/**
 * Parse and validate the dynamic material list.
 *
 * Multipart bodies cannot carry real arrays, so the frontend sends the list as
 * a JSON string in a `materials` field. Both that and a genuine array are
 * accepted so the endpoint also works from a JSON client.
 *
 * @returns {{ materials: Array, problems: string[] }}
 */
const parseMaterials = (raw) => {
    const problems = [];
    let list = raw;

    if (typeof raw === 'string') {
        if (!raw.trim()) return { materials: [], problems };
        try {
            list = JSON.parse(raw);
        } catch {
            return { materials: [], problems: ['Material list could not be read'] };
        }
    }

    if (list == null) return { materials: [], problems };
    if (!Array.isArray(list)) return { materials: [], problems: ['Material list must be a list'] };

    if (list.length > 100) problems.push('At most 100 materials can be submitted');

    const materials = list
        .map((m) => {
            // Accept both a bare string and a structured object, so the shape can
            // grow later without breaking older clients.
            if (typeof m === 'string') return { materialName: clean(m) };
            return {
                materialName: clean(m?.materialName || m?.name),
                description: clean(m?.description),
                unit: clean(m?.unit),
                estimatedRate: m?.estimatedRate === '' || m?.estimatedRate == null
                    ? undefined
                    : Number(m.estimatedRate),
            };
        })
        .filter((m) => m.materialName);

    materials.forEach((m, i) => {
        if (m.materialName.length > 200) problems.push(`Material ${i + 1} name is too long`);
        if (m.estimatedRate !== undefined && (Number.isNaN(m.estimatedRate) || m.estimatedRate < 0)) {
            problems.push(`Material ${i + 1} has an invalid rate`);
        }
    });

    if (!materials.length) problems.push('Add at least one material');

    return { materials, problems };
};

/**
 * Parse and validate the selected services.
 *
 * Only values from the fixed OTHER_SERVICES list are accepted — a vendor cannot
 * invent a service by posting arbitrary text at the API.
 *
 * @returns {{ services: Array, problems: string[] }}
 */
const parseServices = (raw) => {
    const problems = [];
    let list = raw;

    if (typeof raw === 'string') {
        if (!raw.trim()) return { services: [], problems };
        try {
            list = JSON.parse(raw);
        } catch {
            return { services: [], problems: ['Service list could not be read'] };
        }
    }

    if (list == null) return { services: [], problems };
    if (!Array.isArray(list)) return { services: [], problems: ['Service list must be a list'] };

    const allowed = new Map(OTHER_SERVICES.map((sv) => [sv.toLowerCase(), sv]));
    const seen = new Set();
    const services = [];

    list.forEach((entry) => {
        const name = clean(typeof entry === 'string' ? entry : entry?.serviceName || entry?.name);
        if (!name) return;
        const match = allowed.get(name.toLowerCase());
        if (!match) {
            problems.push(`"${name}" is not one of the available services`);
            return;
        }
        if (seen.has(match)) return;   // silently drop repeats
        seen.add(match);
        services.push({ serviceName: match });
    });

    return { services, problems };
};

/**
 * Check that every document required for this submission is present.
 * The GST certificate is only required when a real GST number was supplied.
 *
 * @returns {string[]} problems
 */
const validateRequiredDocuments = (body, files = [], kycType) => {
    const supplied = new Set(files.map((f) => f.fieldname));
    return requiredDocumentsFor(body?.gstNumber, kycType)
        .filter((d) => !supplied.has(d.field))
        .map((d) => `${d.label} is required`);
};

/**
 * Validate one uploaded file against the size and format rules.
 * @returns {string|null} a problem message, or null when the file is fine
 */
const validateFile = (file) => {
    if (!file) return null;

    const name = file.originalname || 'file';
    const ext = path.extname(name).slice(1).toLowerCase();

    // Size — the hard 1 MB per-document ceiling
    if (file.size > MAX_FILE_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(2);
        return `"${name}" is ${mb} MB. Each document must be under ${MAX_FILE_MB} MB.`;
    }
    if (file.size === 0) return `"${name}" is empty.`;

    // Format — mime type AND extension must both be acceptable, so renaming a
    // .exe to .pdf (or sending a false mime type) does not get through.
    const byMime = ALLOWED_TYPES[file.mimetype];
    const extAllowed = ALLOWED_EXTENSIONS.includes(ext);

    if (!byMime || !extAllowed || !byMime.ext.includes(ext)) {
        return `"${name}" is not an accepted format. Upload ${ALLOWED_LABEL} only.`;
    }

    return null;
};

/**
 * Validate the whole set of uploaded files.
 * @returns {string[]} problems
 */
const validateFiles = (files = []) => {
    const problems = [];

    if (files.length > MAX_FILES) {
        problems.push(`Upload at most ${MAX_FILES} documents.`);
        return problems;
    }

    const seenFields = new Set();
    files.forEach((file) => {
        const problem = validateFile(file);
        if (problem) problems.push(problem);

        if (!DOC_FIELD_TO_TYPE[file.fieldname]) {
            problems.push(`"${file.fieldname}" is not a recognised document slot.`);
        } else if (seenFields.has(file.fieldname)) {
            problems.push(`More than one file was sent for ${file.fieldname}.`);
        }
        seenFields.add(file.fieldname);
    });

    return problems;
};

module.exports = {
    validateKycFields, parseMaterials, parseServices, parseOtherStateGst,
    validateRequiredDocuments, validateFile, validateFiles, clean,
};
