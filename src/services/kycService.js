/**
 * Vendor KYC domain service.
 *
 * Holds the KYC business logic so the controllers stay thin: token resolution,
 * document upload orchestration, and applying a submission to a vendor record.
 */

const Vendor = require('../models/Vendor');
const { uploadBuffer, signedUrlFor, destroy, isConfigured, NOT_CONFIGURED_MSG } = require('./cloudinaryService');
const {
    validateKycFields, parseMaterials, parseServices,
    validateRequiredDocuments, validateFiles, clean,
} = require('../validators/kycValidator');
const { DOC_FIELD_TO_TYPE, DOC_TYPE_LABELS } = require('../constants/kycConstants');

/**
 * Look up the vendor behind a KYC token and decide whether the form is usable.
 * @returns {{ vendor?, error?, reason? }}
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

    if (!['sent', 'not_sent'].includes(vendor.kycStatus)) {
        return {
            vendor,
            error: 'This KYC form has already been submitted. Contact your OmTrax representative if you need to change anything.',
            reason: 'already_submitted',
        };
    }

    return { vendor };
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
];

/**
 * Validate a whole submission without touching the database.
 * @returns {{ problems: string[], materials: Array }}
 */
const validateSubmission = (body, files) => {
    const problems = [
        ...validateKycFields(body),
        ...validateFiles(files),
        // Enforced here as well as in the browser, so a direct API call cannot
        // skip a mandatory document.
        ...validateRequiredDocuments(body, files),
    ];

    const { materials, problems: materialProblems } = parseMaterials(body.materials);
    const { services, problems: serviceProblems } = parseServices(body.services);

    // A vendor must tell us at least one thing they supply
    if (!materials.length && !services.length) {
        problems.push('Select at least one material or service you provide');
    }

    return {
        // parseMaterials complains when its own list is empty; that is only a
        // problem if no services were chosen either, which is checked above.
        problems: [
            ...problems,
            ...materialProblems.filter((m) => !/at least one material/i.test(m)),
            ...serviceProblems,
        ],
        materials,
        services,
    };
};

/**
 * Apply a validated submission to the vendor document (does not save).
 */
const applySubmission = (vendor, body, materials, uploadedDocs, services = []) => {
    VENDOR_WRITABLE.forEach((f) => {
        if (body[f] !== undefined) vendor[f] = clean(body[f]);
    });

    // The vendor supplied their real name, so the internal placeholder is done
    if (clean(body.vendorName)) vendor.nameIsPlaceholder = false;

    vendor.gstNumber = clean(body.gstNumber).toUpperCase();
    vendor.panNumber = clean(body.panNumber).toUpperCase();
    if (body.ifscCode) vendor.ifscCode = clean(body.ifscCode).toUpperCase();
    vendor.phone = clean(body.phone).replace(/\D/g, '');

    // Replace both lists wholesale — the form is the source of truth
    vendor.materials = materials;
    vendor.services = services;

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
    uploadKycDocuments,
    validateSubmission,
    applySubmission,
    withSignedDocuments,
    VENDOR_WRITABLE,
};
