/**
 * Vendor KYC document access.
 *
 * Documents are stored in Cloudinary as `type: 'authenticated'`, so the raw
 * Cloudinary URL is not publicly fetchable. Purchase and Finance obtain a
 * short-lived signed URL from here, and only after their permissions have been
 * checked — which is what stops one vendor's documents being reachable by
 * anyone who happens to have a link.
 */

const Vendor = require('../models/Vendor');
const { signedUrlFor, isConfigured } = require('../services/cloudinaryService');
const { canViewVendors, canAccessKycType, DEFAULT_KYC_TYPE } = require('../utils/department');
const { DOC_TYPE_LABELS, SIGNED_URL_TTL_SECONDS } = require('../constants/kycConstants');

const denyUnlessCanView = (req, res) => {
    if (canViewVendors(req.user)) return false;
    res.status(403).json({ success: false, message: 'You do not have access to vendor documents' });
    return true;
};

// Documents follow the same workflow boundary as the vendor record itself:
// Purchase staff cannot open an Operations submission's files, or vice versa.
const denyUnlessCanAccessKyc = (req, res, vendor) => {
    if (canAccessKycType(req.user, vendor?.kycType || DEFAULT_KYC_TYPE)) return false;
    res.status(403).json({
        success: false,
        message: 'This vendor belongs to a KYC workflow your department does not manage.',
    });
    return true;
};

// @desc    List a vendor's KYC documents with fresh signed view/download URLs
// @route   GET /api/vendors/:id/documents
// @access  Private (purchase, finance, admin)
exports.listDocuments = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const vendor = await Vendor.findById(req.params.id).select('vendorName kycDocuments kycStatus kycType');
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        if (denyUnlessCanAccessKyc(req, res, vendor)) return;

        const documents = (vendor.kycDocuments || []).map((d) => ({
            _id: d._id,
            docType: d.docType,
            label: DOC_TYPE_LABELS[d.docType] || 'Document',
            originalName: d.originalName,
            mimeType: d.mimeType,
            format: d.format,
            bytes: d.bytes,
            uploadedAt: d.uploadedAt,
            // Signed, expiring, and only issued to an authorised caller
            viewUrl: signedUrlFor(d, { download: false }),
            downloadUrl: signedUrlFor(d, { download: true }),
        }));

        res.status(200).json({
            success: true,
            data: {
                vendorName: vendor.vendorName,
                kycStatus: vendor.kycStatus,
                documents,
                urlsExpireInSeconds: SIGNED_URL_TTL_SECONDS,
                storageConfigured: isConfigured,
            },
        });
    } catch (error) {
        console.error('List vendor documents error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Redirect to a signed URL for one document (view or download)
// @route   GET /api/vendors/:id/documents/:docId?download=true
// @access  Private (purchase, finance, admin)
exports.openDocument = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const vendor = await Vendor.findById(req.params.id).select('kycDocuments kycType');
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        if (denyUnlessCanAccessKyc(req, res, vendor)) return;

        // id(...) scopes the lookup to THIS vendor, so a document id belonging to
        // another vendor cannot be fetched through this route.
        const doc = vendor.kycDocuments.id(req.params.docId);
        if (!doc) return res.status(404).json({ success: false, message: 'Document not found for this vendor' });

        if (!isConfigured) {
            return res.status(503).json({
                success: false,
                message: 'Document storage is not configured. Ask an administrator to set the Cloudinary credentials.',
            });
        }

        const download = req.query.download === 'true' || req.query.download === '1';
        const url = signedUrlFor(doc, { download });
        if (!url) return res.status(500).json({ success: false, message: 'Could not generate a document link' });

        // JSON when asked for, otherwise a straight redirect so an <a href> works
        if (req.query.format === 'json') {
            return res.status(200).json({ success: true, data: { url, expiresInSeconds: SIGNED_URL_TTL_SECONDS } });
        }
        return res.redirect(url);
    } catch (error) {
        console.error('Open vendor document error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
