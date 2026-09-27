/**
 * Vendor KYC domain service.
 *
 * Holds the KYC business logic so the controllers stay thin: token resolution,
 * document upload orchestration, and applying a submission to a vendor record.
 */

const Vendor = require('../models/Vendor');
const { uploadBuffer, signedUrlFor, destroy, isConfigured, NOT_CONFIGURED_MSG } = require('./cloudinaryService');
const {
    validateKycFields, validateKycFieldsFor, parseMaterials, parseServices, parseOtherStateGst,
    parseServiceLocations, validateRequiredDocuments, validateFiles, clean,
} = require('../validators/kycValidator');
const {
    DOC_FIELD_TO_TYPE, DOC_TYPE_LABELS, formConfig, VEHICLE_SERVICE,
    correctionFieldsFor, isUrp,
} = require('../constants/kycConstants');

/**
 * The correction a Correction KYC Link opens, or null for a full KYC link.
 * A correction link is live only while its round is waiting on the vendor.
 */
const activeCorrection = (vendor) => {
    if (vendor.kycLinkType !== 'correction' || vendor.kycStatus !== 'correction_sent') return null;
    const round = vendor.openCorrection();
    return round && round.status === 'link_generated' ? round : null;
};

/**
 * Look up the vendor behind a KYC token and decide whether the form is usable.
 * @returns {{ vendor?, error?, reason?, correction? }}
 *          `correction` is set when the token is a Correction KYC Link
 */
const resolveToken = async (token) => {
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
        return { error: 'This KYC link is not valid.', reason: 'invalid' };
    }

    const vendor = await Vendor.findOne({ kycToken: token, isActive: true });
    if (!vendor) {
        return { error: 'This KYC link is not valid or has been withdrawn.', reason: 'invalid' };
    }

    if (vendor.kycTokenExpiresAt && vendor.kycTokenExpiresAt < new Date()) {
        return {
            vendor,
            error: 'This KYC link has expired. Please ask your contact for a new one.',
            reason: 'expired',
        };
    }

    // A Correction KYC Link opens the correction it was generated for, and
    // nothing else
    const correction = activeCorrection(vendor);
    if (correction) return { vendor, correction };

    if (vendor.kycLinkType === 'correction' || !['sent', 'not_sent'].includes(vendor.kycStatus)) {
        return {
            vendor,
            error: 'This KYC form has already been submitted. Contact your OmTrax representative if you need to change anything.',
            reason: 'already_submitted',
        };
    }

    return { vendor };
};

/**
 * The selected correction choices of a round, resolved against the form the
 * vendor filled in. Unknown keys (none should exist — they are checked when the
 * link is generated) are dropped.
 */
const selectedCorrectionFields = (vendor, round) => {
    const wanted = new Set(round?.fields || []);
    return correctionFieldsFor(vendor.kycType).filter((f) => wanted.has(f.key));
};

/**
 * Validate a correction submission. Only the details and documents selected for
 * this correction are read; every other field in the request is ignored, so a
 * correction can never change anything it was not generated for.
 *
 * Every selected document must be uploaded — it is being replaced or supplied.
 * The GST certificate is the one exception, and only when the GST value in
 * force (corrected, or as already on record) is URP.
 *
 * @returns {{ problems, selected, materials, services, otherStateGst, serviceLocations }}
 */
const validateCorrection = (body, files, vendor, round) => {
    const config = formConfig(vendor.kycType);
    const selected = selectedCorrectionFields(vendor, round);
    const keys = new Set(selected.map((f) => f.key));
    const fields = selected.filter((f) => f.type === 'field');
    const docs = selected.filter((f) => f.type === 'document');

    const problems = validateKycFieldsFor(body, fields.flatMap((f) => f.bodyFields));

    // --- Documents: format and size as usual, but only the selected slots ---
    problems.push(...validateFiles(files, config.kycType));
    const docKeys = new Set(docs.map((d) => d.key));
    files.forEach((file) => {
        if (DOC_FIELD_TO_TYPE[file.fieldname] && !docKeys.has(file.fieldname)) {
            problems.push(`"${file.fieldname}" is not part of this correction.`);
        }
    });
    const effectiveGst = keys.has('gstNumber') ? body.gstNumber : vendor.gstNumber;
    const supplied = new Set(files.map((f) => f.fieldname));
    docs
        .filter((d) => !(d.requiresGst && isUrp(effectiveGst)))
        .forEach((d) => {
            if (!supplied.has(d.key)) problems.push(`${d.label} is required`);
        });

    // --- Lists ---
    const out = { materials: null, services: null, otherStateGst: null, serviceLocations: null };
    if (keys.has('materials')) {
        const { materials, problems: p } = parseMaterials(body.materials);
        out.materials = materials;
        problems.push(...(materials.length ? p : ['Select at least one material you supply']));
    }
    if (keys.has('services')) {
        const { services, problems: p } = parseServices(body.services);
        out.services = services;
        problems.push(...p);
        if (!services.length) problems.push('Select at least one service you provide');
    }
    if (keys.has('otherStateGst')) {
        const { otherStateGst, problems: p } = parseOtherStateGst(body.otherStateGst);
        out.otherStateGst = otherStateGst;
        problems.push(...p);
    }
    if (keys.has('serviceLocations')) {
        const { serviceLocations, problems: p } = parseServiceLocations(body.serviceLocations);
        out.serviceLocations = serviceLocations;
        problems.push(...p);
        if (!serviceLocations.length) problems.push('Add at least one Service Location (State / UT)');
    }

    return { problems, selected, ...out };
};

/**
 * Apply a validated correction to the SAME vendor record (does not save).
 * Only the selected details are overwritten; each selected document replaces
 * the one on record of the same type. The replaced documents are returned so
 * the caller can remove them from Cloudinary once the save has succeeded.
 *
 * @returns {{ replaced: Array }} the superseded document sub-documents
 */
const applyCorrection = (vendor, body, parsed, uploadedDocs, round) => {
    const config = formConfig(vendor.kycType);
    const { selected } = parsed;
    const keys = new Set(selected.map((f) => f.key));
    const bodyFields = selected.filter((f) => f.type === 'field').flatMap((f) => f.bodyFields);

    bodyFields.forEach((f) => {
        if (f === 'numberOfVehicles') return;              // handled with services below
        vendor[f] = clean(body[f]);
    });
    if (bodyFields.includes('gstNumber')) vendor.gstNumber = clean(body.gstNumber).toUpperCase();
    if (bodyFields.includes('panNumber')) vendor.panNumber = clean(body.panNumber).toUpperCase();
    if (bodyFields.includes('ifscCode')) vendor.ifscCode = clean(body.ifscCode).toUpperCase();
    if (bodyFields.includes('phone')) vendor.phone = clean(body.phone).replace(/\D/g, '');
    if (bodyFields.includes('vendorName')) vendor.nameIsPlaceholder = false;

    // Same "do you have one?" rule as the full form
    const saidNo = (v) => v === false || ['false', '0', 'no', 'off'].includes(String(v ?? '').trim().toLowerCase());
    if (keys.has('shopEstablishment') && body.hasShopEstablishment !== undefined && saidNo(body.hasShopEstablishment)) {
        vendor.shopEstablishmentNumber = '';
    }

    // Lists are replaced wholesale, exactly as the full form does
    if (parsed.materials) vendor.materials = parsed.materials;
    if (parsed.otherStateGst) vendor.otherStateGst = parsed.otherStateGst;
    if (parsed.serviceLocations) vendor.serviceLocations = parsed.serviceLocations;
    if (parsed.services) {
        vendor.services = parsed.services;
        if (config.collectsVehicles) {
            const transports = parsed.services.some((sv) => sv.serviceName === VEHICLE_SERVICE);
            if (!transports) vendor.numberOfVehicles = undefined;
            else if (clean(body.numberOfVehicles)) vendor.numberOfVehicles = Number(clean(body.numberOfVehicles));
        }
    }

    // Each corrected upload replaces the document of the same type
    const replacedTypes = new Set(uploadedDocs.map((d) => d.docType));
    const replaced = (vendor.kycDocuments || []).filter((d) => replacedTypes.has(d.docType));
    if (replaced.length) {
        vendor.kycDocuments = vendor.kycDocuments.filter((d) => !replacedTypes.has(d.docType));
    }
    if (uploadedDocs.length) vendor.kycDocuments.push(...uploadedDocs);

    const now = new Date();
    round.status = 'submitted';
    round.submittedAt = now;
    round.replacedDocuments = replaced.map((d) => ({
        docType: d.docType, originalName: d.originalName, uploadedAt: d.uploadedAt,
    }));

    // Back into Finance's normal review queue
    vendor.kycStatus = 'submitted';
    vendor.kycSubmittedAt = now;
    vendor.kycHistory.push({
        action: 'correction_submitted',
        at: now,
        byName: vendor.contactPerson || vendor.vendorName,
        byRole: 'vendor',
        fromStatus: 'correction_sent',
        toStatus: 'submitted',
        remarks: `Correction round ${round.round}: ${selected.map((f) => f.label).join(', ')}`,
    });

    return { replaced };
};

/**
 * Upload every validated file to Cloudinary and return the document sub-documents.
 *
 * Uploads run in PARALLEL rather than one after another. Measured against a live
 * Cloudinary account with five 180 KB files this is roughly 1.3x faster — the
 * gain is modest because the uplink saturates, but it removes the per-file
 * round-trip stacking that hurt most when several large documents were attached.
 *
 * If any file fails, the ones that already succeeded are deleted before throwing,
 * so a failed submission never leaves orphaned assets in Cloudinary.
 */
const uploadKycDocuments = async (files, vendorId) => {
    if (!files.length) return [];
    if (!isConfigured) throw new Error(NOT_CONFIGURED_MSG);

    const stamp = Date.now();

    const settled = await Promise.all(
        files.map(async (file, i) => {
            try {
                const result = await uploadBuffer(file.buffer, {
                    publicId: `vendor_${vendorId}_${file.fieldname}_${stamp}_${i}`,
                    originalName: file.originalname,
                    mimetype: file.mimetype,
                });
                return {
                    ok: true,
                    doc: {
                        docType: DOC_FIELD_TO_TYPE[file.fieldname] || 'other',
                        originalName: file.originalname,
                        mimeType: file.mimetype,
                        format: result.format,
                        bytes: result.bytes ?? file.size,
                        url: result.url,
                        publicId: result.publicId,
                        resourceType: result.resourceType,
                        uploadedAt: new Date(),
                    },
                };
            } catch (err) {
                console.error(`KYC upload failed for ${file.originalname}:`, err.message);
                return { ok: false, name: file.originalname, reason: err.message };
            }
        })
    );

    const failures = settled.filter((r) => !r.ok);
    if (failures.length) {
        // Roll back the successful uploads so nothing is left stranded
        await Promise.all(
            settled.filter((r) => r.ok).map((r) => destroy(r.doc).catch(() => false))
        );
        const names = failures.map((f) => `"${f.name}"`).join(', ');
        const timedOut = failures.some((f) => /timed out/i.test(f.reason || ''));
        throw new Error(
            timedOut
                ? `Uploading ${names} timed out. Please check your connection and try again.`
                : `Could not upload ${names}. Please try again.`
        );
    }

    return settled.map((r) => r.doc);
};

// Fields the vendor may write through the public form. Deliberately excludes
// anything that would let them influence their own approval.
const VENDOR_WRITABLE = [
    'vendorName', 'companyName', 'contactPerson', 'email', 'phone',
    'address', 'city', 'state', 'pincode',
    'gstNumber', 'panNumber',
    'bankName', 'accountHolderName', 'accountNumber', 'ifscCode',
    'kycAdditionalInfo',
    // Optional statutory details, collected on both forms.
    // `iecCode` is no longer collected; the schema keeps existing values.
    'esiNumber', 'pfNumber', 'shopEstablishmentNumber',
    'companySize', 'serviceLocation',
];

/**
 * Validate a whole submission without touching the database.
 *
 * The two forms collect different things, so what counts as "tell us what you
 * supply" differs: Purchase asks for materials, Operations for services. A list
 * the form does not collect is ignored rather than rejected, so a stray field
 * from an old client cannot block a submission.
 *
 * @returns {{ problems: string[], materials: Array, services: Array, otherStateGst: Array }}
 */
const validateSubmission = (body, files, kycType) => {
    const config = formConfig(kycType);

    const problems = [
        ...validateKycFields(body),
        ...validateFiles(files, config.kycType),
        // Enforced here as well as in the browser, so a direct API call cannot
        // skip a mandatory document.
        ...validateRequiredDocuments(body, files, config.kycType),
    ];

    const { materials, problems: materialProblems } = parseMaterials(body.materials);
    const { services, problems: serviceProblems } = parseServices(body.services);
    const { otherStateGst, problems: gstProblems } = parseOtherStateGst(body.otherStateGst);
    const { serviceLocations, problems: locationProblems } = parseServiceLocations(body.serviceLocations);

    // Only keep what this form actually collects
    const keptMaterials = config.collectsMaterials ? materials : [];
    const keptServices = config.collectsServices ? services : [];

    if (config.collectsMaterials && config.collectsServices) {
        if (!keptMaterials.length && !keptServices.length) {
            problems.push('Select at least one material or service you provide');
        }
    } else if (config.collectsMaterials && !keptMaterials.length) {
        problems.push('Select at least one material you supply');
    } else if (config.collectsServices && !keptServices.length) {
        problems.push('Select at least one service you provide');
    }

    // At least one state must be named on both forms. Cities stay optional —
    // a vendor covering a whole state names no city.
    if (!serviceLocations.length) {
        problems.push('Add at least one Service Location (State / UT)');
    }

    return {
        // The parsers complain when their own list is empty; whether that is
        // actually a problem depends on the form, and is decided above.
        problems: [
            ...problems,
            ...(config.collectsMaterials ? materialProblems.filter((m) => !/at least one material/i.test(m)) : []),
            ...(config.collectsServices ? serviceProblems.filter((m) => !/at least one service/i.test(m)) : []),
            ...gstProblems,
            ...locationProblems,
        ],
        materials: keptMaterials,
        services: keptServices,
        otherStateGst,
        serviceLocations,
    };
};

/**
 * Apply a validated submission to the vendor document (does not save).
 */
const applySubmission = (vendor, body, materials, uploadedDocs, services = [], otherStateGst = [], serviceLocations = []) => {
    const config = formConfig(vendor.kycType);

    VENDOR_WRITABLE.forEach((f) => {
        if (body[f] !== undefined) vendor[f] = clean(body[f]);
    });

    // The vendor supplied their real name, so the internal placeholder is done
    if (clean(body.vendorName)) vendor.nameIsPlaceholder = false;

    vendor.gstNumber = clean(body.gstNumber).toUpperCase();
    vendor.panNumber = clean(body.panNumber).toUpperCase();
    if (body.ifscCode) vendor.ifscCode = clean(body.ifscCode).toUpperCase();
    vendor.phone = clean(body.phone).replace(/\D/g, '');

    // Replace wholesale — the form is the source of truth
    vendor.materials = materials;
    vendor.services = services;
    vendor.otherStateGst = otherStateGst;
    // Many states, each with optional cities. Replaced wholesale — the form is
    // the source of truth. The legacy single-value serviceLocation is left as
    // it was so an older record keeps the value it already had.
    vendor.serviceLocations = serviceLocations;

    // Operations only, and only when the vendor actually offers Transportation
    // — the field is hidden otherwise, so a stale value must not be kept.
    // Left untouched on a Purchase submission, where the field does not exist.
    if (config.collectsVehicles) {
        const transports = services.some((sv) => sv.serviceName === VEHICLE_SERVICE);
        if (!transports) vendor.numberOfVehicles = undefined;
        else if (clean(body.numberOfVehicles)) {
            vendor.numberOfVehicles = Number(clean(body.numberOfVehicles));
        }
    }

    // PF and ESI sit behind "do you have one?" checkboxes. When the vendor says
    // no, the number is cleared here rather than trusted from the body — a
    // direct API call cannot answer "no" and still store a number.
    const saidNo = (v) => v === false || ['false', '0', 'no', 'off'].includes(String(v ?? '').trim().toLowerCase());
    // PF and ESI are now collected as documents; these two only matter for a
    // client still sending the old numeric fields.
    if (body.hasPfNumber !== undefined && saidNo(body.hasPfNumber)) vendor.pfNumber = '';
    if (body.hasEsiNumber !== undefined && saidNo(body.hasEsiNumber)) vendor.esiNumber = '';
    // Shop Establishment and IEC sit behind their own "do you have one?" boxes
    if (body.hasShopEstablishment !== undefined && saidNo(body.hasShopEstablishment)) {
        vendor.shopEstablishmentNumber = '';
    }

    if (uploadedDocs.length) vendor.kycDocuments.push(...uploadedDocs);

    vendor.kycStatus = 'submitted';
    vendor.kycSubmittedAt = new Date();
    vendor.kycHistory.push({
        action: 'submitted',
        at: new Date(),
        byName: vendor.contactPerson || vendor.vendorName,
        byRole: 'vendor',
        fromStatus: 'sent',
        toStatus: 'submitted',
        remarks: `${uploadedDocs.length} document(s), ${materials.length} material(s), ${services.length} service(s)`,
    });

    return vendor;
};

/**
 * Decorate a vendor's documents with per-request signed view/download URLs.
 * Called only after the caller's permissions have been checked.
 */
const withSignedDocuments = (vendor) => {
    const obj = typeof vendor.toSafeJSON === 'function' ? vendor.toSafeJSON() : { ...vendor };
    obj.kycDocuments = (obj.kycDocuments || []).map((d) => ({
        ...d,
        label: DOC_TYPE_LABELS[d.docType] || 'Document',
        viewUrl: signedUrlFor(d, { download: false }),
        downloadUrl: signedUrlFor(d, { download: true }),
    }));
    return obj;
};

module.exports = {
    resolveToken,
    activeCorrection,
    selectedCorrectionFields,
    uploadKycDocuments,
    validateSubmission,
    applySubmission,
    validateCorrection,
    applyCorrection,
    withSignedDocuments,
    VENDOR_WRITABLE,
};
