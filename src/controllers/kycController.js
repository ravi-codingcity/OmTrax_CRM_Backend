/**
 * PUBLIC Vendor KYC form controller.
 *
 * The vendor has no CRM account, so these routes sit outside `protect`. The
 * secret is the 64-hex token in the URL: it identifies exactly one vendor,
 * expires, and stops working once the form is submitted.
 *
 * Business logic lives in services/kycService.js; validation in
 * validators/kycValidator.js. This file only handles the HTTP layer.
 */

const Notification = require('../models/Notification');
const kycService = require('../services/kycService');
const { isConfigured } = require('../services/cloudinaryService');
const { notifyRoles } = require('./vendorController');
const { FINANCE_ROLES } = require('../utils/department');
const {
    KYC_DOCUMENTS, MAX_FILE_MB, ALLOWED_LABEL, ALLOWED_EXTENSIONS,
    OTHER_SERVICES, URP_VALUE, isUrp,
} = require('../constants/kycConstants');
const Item = require('../models/Item');
const { MASTER_ITEMS } = require('../constants/purchaseConstants');

/**
 * Material options for the KYC form's dropdown.
 *
 * Sourced from the Purchase Department's item master — whatever the Purchase
 * Manager maintains there becomes selectable here, so nothing is hard-coded and
 * new materials appear automatically. Merged with the predefined master list and
 * de-duplicated, mirroring what itemController.getItems does internally.
 *
 * Only names are exposed; no pricing, supplier or stock data reaches the vendor.
 */
const materialOptions = async () => {
    try {
        const dbItems = await Item.find({ isActive: true }).select('name').lean();
        const seen = new Set();
        const names = [];
        [...dbItems.map((i) => i.name), ...MASTER_ITEMS.map((i) => i.name)].forEach((n) => {
            const key = String(n || '').trim().toLowerCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            names.push(String(n).trim());
        });
        return names.sort((a, b) => a.localeCompare(b));
    } catch (err) {
        console.error('Material options lookup failed:', err.message);
        // The form is still usable with services alone
        return MASTER_ITEMS.map((i) => i.name).sort((a, b) => a.localeCompare(b));
    }
};

// @desc    Fetch the form behind a KYC link (what the vendor sees)
// @route   GET /api/kyc/:token
// @access  Public
exports.getKycForm = async (req, res) => {
    try {
        const { vendor, error, reason } = await kycService.resolveToken(req.params.token);

        if (error) {
            return res.status(reason === 'already_submitted' ? 409 : 410).json({
                success: false,
                message: error,
                status: reason,
                // Enough for a legitimate vendor to know they are in the right place
                vendorName: vendor?.nameIsPlaceholder ? null : (vendor?.vendorName || null),
            });
        }

        res.status(200).json({
            success: true,
            data: {
                // Pre-filled from whatever Purchase/Finance already recorded
                // Blank when the stored name is our internal placeholder — the
                // vendor types their own name rather than seeing a request id.
                vendorName: vendor.nameIsPlaceholder ? '' : (vendor.vendorName || ''),
                companyName: vendor.companyName || '',
                contactPerson: vendor.contactPerson || '',
                email: vendor.email || '',
                phone: vendor.phone || '',
                address: vendor.address || '',
                city: vendor.city || '',
                state: vendor.state || '',
                pincode: vendor.pincode || '',
                gstNumber: vendor.gstNumber || '',
                panNumber: vendor.panNumber || '',
                materials: (vendor.materials || []).map((m) => ({ materialName: m.materialName })),
                services: (vendor.services || []).map((sv) => ({ serviceName: sv.serviceName })),
                // Dropdown sources: materials come from the Purchase Department's
                // item master, services from the fixed list.
                materialOptions: await materialOptions(),
                serviceOptions: OTHER_SERVICES,
                urpValue: URP_VALUE,
                expiresAt: vendor.kycTokenExpiresAt,
                // Everything the form needs to render itself and validate locally
                documents: KYC_DOCUMENTS.map(({ field, label, required, requiresGst }) => ({
                    field, label, required, requiresGst: !!requiresGst,
                })),
                limits: {
                    maxFileMB: MAX_FILE_MB,
                    allowedLabel: ALLOWED_LABEL,
                    allowedExtensions: ALLOWED_EXTENSIONS,
                },
                uploadsEnabled: isConfigured,
            },
        });
    } catch (error) {
        console.error('Get KYC form error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Vendor submits their KYC details, materials and documents
// @route   POST /api/kyc/:token
// @access  Public (multipart/form-data)
exports.submitKyc = async (req, res) => {
    try {
        const { vendor, error, reason } = await kycService.resolveToken(req.params.token);
        if (error) {
            return res.status(reason === 'already_submitted' ? 409 : 410).json({ success: false, message: error });
        }

        const files = req.files || [];

        // --- Validate everything before touching Cloudinary or Mongo ---
        const { problems, materials, services } = kycService.validateSubmission(req.body || {}, files);
        if (problems.length) {
            return res.status(400).json({
                success: false,
                message: 'Please correct the highlighted fields',
                errors: problems,
            });
        }

        if (files.length && !isConfigured) {
            return res.status(503).json({
                success: false,
                message: 'Document upload is temporarily unavailable. Please try again later or contact your OmTrax representative.',
            });
        }

        // --- Upload, then persist ---
        let uploaded;
        try {
            uploaded = await kycService.uploadKycDocuments(files, vendor._id);
        } catch (err) {
            return res.status(502).json({ success: false, message: err.message });
        }

        kycService.applySubmission(vendor, req.body, materials, uploaded, services);
        await vendor.save();

        // --- Notify Finance that a submission is waiting ---
        await notifyRoles(FINANCE_ROLES, {
            type: 'vendor_kyc_submitted',
            vendor: vendor._id,
            companyName: vendor.companyName || vendor.vendorName,
            salesPersonName: vendor.contactPerson || vendor.vendorName,
            remark: `Source: ${vendor.kycSource || 'purchase'} • ${uploaded.length} document(s) • ${materials.length} material(s), ${services.length} service(s)`,
            department: 'finance',
        });
        // Mirror to admins so nothing is missed if no Finance user exists yet
        try {
            await Notification.create({
                type: 'vendor_kyc_submitted',
                vendor: vendor._id,
                companyName: vendor.companyName || vendor.vendorName,
                salesPersonName: vendor.contactPerson || vendor.vendorName,
                remark: 'Awaiting Finance approval',
                forRole: 'admin',
                department: 'finance',
            });
        } catch (err) {
            console.error('KYC admin notification failed:', err.message);
        }

        res.status(200).json({
            success: true,
            message: 'Thank you — your KYC details have been submitted and are now with our Finance team for review.',
            data: {
                vendorName: vendor.vendorName,
                submittedAt: vendor.kycSubmittedAt,
                documents: uploaded.length,
                materials: materials.length,
                services: services.length,
            },
        });
    } catch (error) {
        console.error('Submit KYC error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
