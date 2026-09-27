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
    allowedTypesFor, allowedExtensionsFor, allowedLabelFor,
    DOC_FIELD_TO_TYPE, OTHER_SERVICES, URP_VALUE, isUrp, requiredDocumentsFor,
    GST_RX, PAN_RX, IFSC_RX, EMAIL_RX, PHONE_RX,
    isIndianState, COMPANY_SIZES, MAX_OTHER_STATE_GST, documentsForType,
    MAX_SERVICE_STATES, MAX_CITIES_PER_STATE, MAX_CITY_NAME_LENGTH,
} = require('../constants/kycConstants');

const clean = (v) => String(v ?? '').trim();

/**
 * The rule for each text field of a KYC submission, in the order the problems
 * are reported. Keyed by form field so a correction — which resubmits only some
 * fields — can apply exactly the rules for those fields and no others.
 */
const FIELD_RULES = [
    // --- Vendor information ---
    ['vendorName', (body) => (clean(body.vendorName) ? [] : ['Legal Name (as per PAN) is required'])],
    ['companyName', (body) => (clean(body.companyName) ? [] : ['Vendor Company Name is required'])],
    ['address', (body) => (clean(body.address) ? [] : ['Company address is required'])],
    ['email', (body) => {
        const email = clean(body.email);
        if (!email) return ['Email ID is required'];
        return EMAIL_RX.test(email) ? [] : ['Enter a valid email address'];
    }],
    ['phone', (body) => {
        const phone = clean(body.phone).replace(/\D/g, '');
        if (!phone) return ['Phone number is required'];
        return PHONE_RX.test(phone) ? [] : ['Phone number must be 10 digits'];
    }],
    // Either a valid GST number, or URP for a vendor who is not GST registered
    ['gstNumber', (body) => {
        const gst = clean(body.gstNumber).toUpperCase();
        if (!gst) return [`GST Number / URP is required — enter your GST number, or ${URP_VALUE} if you are not GST registered`];
        if (!isUrp(gst) && !GST_RX.test(gst)) {
            return [`Enter a valid GST number (e.g. 07AABCU9603R1ZM), or ${URP_VALUE} if you are not GST registered`];
        }
        return [];
    }],
    ['panNumber', (body) => {
        const pan = clean(body.panNumber).toUpperCase();
        if (!pan) return ['PAN card number is required'];
        return PAN_RX.test(pan) ? [] : ['PAN format looks incorrect (e.g. ABCDE1234F)'];
    }],

    // --- Banking (optional here, but validated when supplied) ---
    ['ifscCode', (body) => {
        const ifsc = clean(body.ifscCode).toUpperCase();
        return ifsc && !IFSC_RX.test(ifsc) ? ['IFSC code format looks incorrect (e.g. HDFC0001234)'] : [];
    }],

    // --- Optional statutory details -----------------------------------------
    // ESI, PF, Shop Establishment and IEC are free-format across registrars, so
    // only a sane length is enforced. Service Location and Company Size come
    // from dropdowns, so an off-list value means a hand-crafted request.
    // Legacy single-value field. New clients send serviceLocations instead,
    // which parseServiceLocations validates.
    ['serviceLocation', (body) => {
        const location = clean(body.serviceLocation);
        return location && !isIndianState(location)
            ? ['Select a Service Location from the list of Indian States and Union Territories']
            : [];
    }],
    ['companySize', (body) => {
        const size = clean(body.companySize);
        return size && !COMPANY_SIZES.includes(size) ? ['Select a Company Size from the list'] : [];
    }],
    ...[['esiNumber', 'ESI Number'], ['pfNumber', 'PF Number'],
        ['shopEstablishmentNumber', 'Shop Establishment Number']].map(([f, label]) => (
        [f, (body) => (clean(body[f]).length > 40 ? [`${label} is too long`] : [])]
    )),

    // Operations only, but harmless to validate whenever it is supplied
    ['numberOfVehicles', (body) => {
        const vehicles = clean(body.numberOfVehicles);
        if (!vehicles) return [];
        const n = Number(vehicles);
        if (!Number.isInteger(n) || n < 0) return ['Number of Vehicles must be a whole number'];
        if (n > 100000) return ['Number of Vehicles looks too large'];
        return [];
    }],
];

/**
 * Validate the text fields of a KYC submission.
 * @returns {string[]} human-readable problems; empty means valid
 */
const validateKycFields = (body = {}) => FIELD_RULES.flatMap(([, rule]) => rule(body));

/**
 * The same rules, applied only to the named fields — for a correction, which
 * resubmits a chosen subset of the form.
 * @returns {string[]} problems
 */
const validateKycFieldsFor = (body = {}, fields = []) => {
    const wanted = new Set(fields);
    return FIELD_RULES.filter(([field]) => wanted.has(field)).flatMap(([, rule]) => rule(body));
};

/**
 * Parse the Service Locations list: the states a vendor covers, each with an
 * optional set of cities.
 *
 * The STATE is constrained to the official list; cities deliberately are not,
 * because the vendor may type one the dropdown does not offer. Cities are
 * trimmed, de-duplicated case-insensitively, and length-capped.
 *
 * @returns {{ serviceLocations: Array, problems: string[] }}
 */
const parseServiceLocations = (raw) => {
    const problems = [];
    let list = raw;

    if (typeof raw === 'string') {
        if (!raw.trim()) return { serviceLocations: [], problems };
        try {
            list = JSON.parse(raw);
        } catch {
            return { serviceLocations: [], problems: ['Service location list could not be read'] };
        }
    }

    if (list == null) return { serviceLocations: [], problems };
    if (!Array.isArray(list)) return { serviceLocations: [], problems: ['Service location list must be a list'] };
    if (list.length > MAX_SERVICE_STATES) {
        return { serviceLocations: [], problems: [`At most ${MAX_SERVICE_STATES} service locations can be submitted`] };
    }

    const seenStates = new Set();
    const rows = [];

    list.forEach((row, i) => {
        const at = `Service location #${i + 1}`;
        const state = clean(row && (row.state ?? row.stateName));
        const rawCities = (row && row.cities) || [];

        // A wholly blank row is an untouched input — skip it silently
        if (!state && (!Array.isArray(rawCities) || rawCities.length === 0)) return;

        if (!state) {
            problems.push(`${at}: select a state`);
            return;
        }
        if (!isIndianState(state)) {
            problems.push(`${at}: "${state}" is not a recognised state`);
            return;
        }
        if (seenStates.has(state)) {
            problems.push(`${at}: ${state} is listed more than once`);
            return;
        }

        if (!Array.isArray(rawCities)) {
            problems.push(`${at}: cities must be a list`);
            return;
        }
        if (rawCities.length > MAX_CITIES_PER_STATE) {
            problems.push(`${at}: at most ${MAX_CITIES_PER_STATE} cities per state`);
            return;
        }

        const seenCities = new Set();
        const cities = [];
        rawCities.forEach((c) => {
            const name = clean(c);
            if (!name) return;                         // blank entry, ignore
            if (name.length > MAX_CITY_NAME_LENGTH) {
                problems.push(`${at}: "${name.slice(0, 20)}..." is too long for a city name`);
                return;
            }
            const key = name.toLowerCase();
            if (seenCities.has(key)) return;           // duplicate, ignore
            seenCities.add(key);
            cities.push(name);
        });

        seenStates.add(state);
        // Cities stay optional — a state on its own is a valid location
        rows.push({ state, cities });
    });

    return { serviceLocations: rows, problems };
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
    // Which formats count depends on the slot: only the template documents
    // accept Word files.
    const field = file.fieldname;
    const byMime = allowedTypesFor(field)[file.mimetype];
    const extAllowed = allowedExtensionsFor(field).includes(ext);

    if (!byMime || !extAllowed || !byMime.ext.includes(ext)) {
        return `"${name}" is not an accepted format. Upload ${allowedLabelFor(field)} only.`;
    }

    return null;
};

/**
 * Validate the whole set of uploaded files.
 * @returns {string[]} problems
 */
const validateFiles = (files = [], kycType) => {
    const problems = [];

    if (files.length > MAX_FILES) {
        problems.push(`Upload at most ${MAX_FILES} documents.`);
        return problems;
    }

    // Only the slots THIS form offers are accepted. The TDS declaration, for
    // example, belongs to Operations, so a Purchase submission carrying one is
    // rejected rather than silently stored.
    const offered = new Set(documentsForType(kycType).map((d) => d.field));

    const seenFields = new Set();
    files.forEach((file) => {
        const problem = validateFile(file);
        if (problem) problems.push(problem);

        if (!DOC_FIELD_TO_TYPE[file.fieldname]) {
            problems.push(`"${file.fieldname}" is not a recognised document slot.`);
        } else if (!offered.has(file.fieldname)) {
            problems.push(`"${file.fieldname}" is not part of this KYC form.`);
        } else if (seenFields.has(file.fieldname)) {
            problems.push(`More than one file was sent for ${file.fieldname}.`);
        }
        seenFields.add(file.fieldname);
    });

    return problems;
};

module.exports = {
    validateKycFields, validateKycFieldsFor, parseMaterials, parseServices, parseOtherStateGst,
    parseServiceLocations,
    validateRequiredDocuments, validateFile, validateFiles, clean,
};
