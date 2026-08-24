const Vendor = require('../models/Vendor');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const {
    canViewVendors, canEditVendors, canGenerateKycLink, canReviewKyc,
    isFinanceUser, isPurchaseUser, isAdminLevel,
    PURCHASE_ROLES, FINANCE_ROLES,
} = require('../utils/department');

const { withSignedDocuments } = require('../services/kycService');
const { TOKEN_TTL_DAYS } = require('../constants/kycConstants');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The public form lives on the frontend, which reads the token from the path.
const publicKycUrl = (token) => {
    const base = (process.env.PUBLIC_APP_URL || 'https://omtraxcrm.in').replace(/\/+$/, '');
    return `${base}/kyc/${token}`;
};

// Fire-and-forget notification — never let a notification failure break the request.
const notify = async (payload) => {
    try {
        await Notification.create(payload);
    } catch (err) {
        console.error('Vendor notification failed:', err.message);
    }
};

// Notify every active user of the given roles.
const notifyRoles = async (roles, payload) => {
    try {
        const users = await User.find({ role: { $in: roles }, isActive: true }).select('_id role');
        await Promise.all(users.map((u) => notify({ ...payload, forUser: u._id, forRole: u.role })));
    } catch (err) {
        console.error('Vendor role notification failed:', err.message);
    }
};

const denyUnlessCanView = (req, res) => {
    if (canViewVendors(req.user)) return false;
    res.status(403).json({ success: false, message: 'You do not have access to the vendor register' });
    return true;
};

const denyUnlessCanEdit = (req, res) => {
    if (canEditVendors(req.user)) return false;
    res.status(403).json({
        success: false,
        message: 'You are not allowed to create or edit vendor records. Finance reviews vendor details rather than editing them.',
    });
    return true;
};

const denyUnlessCanGenerateLink = (req, res) => {
    if (canGenerateKycLink(req.user)) return false;
    res.status(403).json({ success: false, message: 'You are not allowed to generate KYC links' });
    return true;
};

// Fields the internal team may set directly on a vendor record.
// `category` and `paymentTerms` were removed from the Add Vendor form; the
// schema still holds them so existing records keep their data, but they are no
// longer writable from the UI.
const EDITABLE = [
    'vendorName', 'companyName', 'contactPerson', 'email', 'phone',
    'address', 'city', 'state', 'pincode', 'gstNumber', 'panNumber',
    'bankName', 'accountHolderName', 'accountNumber', 'ifscCode',
];

// @desc    Create a vendor
// @route   POST /api/vendors
// @access  Private (admin, purchase_manager, finance)
exports.createVendor = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }
        if (denyUnlessCanEdit(req, res)) return;

        const data = {};
        EDITABLE.forEach((f) => {
            if (req.body[f] !== undefined) data[f] = req.body[f];
        });

        // Which department this vendor originated from
        data.department = isFinanceUser(req.user) ? 'finance' : 'purchase';
        data.createdBy = req.user.id;
        data.createdByName = req.user.name;
        // Adding a vendor NEVER generates a KYC link. The two are independent
        // actions: a link is minted only by generateKycLink / createKycRequest.
        data.kycStatus = 'not_sent';

        const vendor = new Vendor(data);
        vendor.logKyc('created', req.user, { toStatus: 'not_sent' });
        await vendor.save();

        res.status(201).json({
            success: true,
            message: 'Vendor created successfully',
            data: vendor.toSafeJSON(),
        });
    } catch (error) {
        console.error('Create vendor error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Start a KYC request without filling in the Add Vendor form.
//
//          This is the second, independent way into the vendor register: rather
//          than typing the vendor's details yourself, you create the request
//          with just enough to identify them, send the link, and the vendor
//          fills everything in. Adding a vendor manually never does this.
//
// @route   POST /api/vendors/kyc-request
// @access  Private (admin, director, purchase_manager, finance)
exports.createKycRequest = async (req, res) => {
    try {
        if (denyUnlessCanGenerateLink(req, res)) return;

        // Nothing is asked for up front. The button mints a link straight away and
        // the vendor supplies every detail — including their own name — through
        // the form. A short placeholder keeps the record findable until then.
        const vendorName = String(req.body.vendorName || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Enter a valid email address' });
        }

        // Regenerating for an existing vendor is still supported
        let vendor = null;
        if (req.body.vendorId) {
            vendor = await Vendor.findById(req.body.vendorId);
            if (!vendor || !vendor.isActive) {
                return res.status(404).json({ success: false, message: 'Vendor not found' });
            }
        } else if (vendorName) {
            // Only guard against duplicates when a name was actually supplied
            const existing = await Vendor.findOne({
                isActive: true,
                vendorName: new RegExp(`^${escapeRegex(vendorName)}$`, 'i'),
            });
            if (existing) {
                return res.status(409).json({
                    success: false,
                    message: `"${existing.vendorName}" is already in the vendor register. Generate the KYC link from their record instead.`,
                    data: { vendorId: existing._id, kycStatus: existing.kycStatus },
                });
            }
        }

        const source = isFinanceUser(req.user) ? 'finance' : 'purchase';

        if (!vendor) {
            // A shell record — the vendor supplies the rest through the form.
            // The placeholder is overwritten by whatever name they submit.
            const placeholder = `Awaiting KYC · ${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`;
            vendor = new Vendor({
                vendorName: vendorName || placeholder,
                nameIsPlaceholder: !vendorName,
                email: email || undefined,
                phone: String(req.body.phone || '').trim() || undefined,
                contactPerson: String(req.body.contactPerson || '').trim() || undefined,
                department: source,
                createdBy: req.user.id,
                createdByName: req.user.name,
                kycStatus: 'not_sent',
            });
            vendor.logKyc('created', req.user, { toStatus: 'not_sent', remarks: 'Created from a KYC request' });
        }

        const previous = vendor.kycStatus;
        if (previous === 'approved' && !req.body.confirmReset) {
            return res.status(400).json({
                success: false,
                message: `"${vendor.vendorName}" is already approved. Re-sending the KYC form would reset that approval.`,
                requiresConfirmation: true,
            });
        }

        vendor.kycToken = Vendor.generateToken();
        vendor.kycTokenGeneratedAt = new Date();
        vendor.kycTokenExpiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000);
        vendor.kycStatus = 'sent';
        vendor.kycLinkSentAt = new Date();
        vendor.kycSource = source;
        vendor.kycSourceUser = req.user.id;
        vendor.kycSourceUserName = req.user.name;

        if (previous === 'approved' || previous === 'rejected') {
            vendor.financeReview = { decision: null, remarks: '', reviewedBy: null, reviewedByName: '', reviewedAt: null };
            vendor.logKyc('reset', req.user, { fromStatus: previous, toStatus: 'sent' });
        }
        vendor.logKyc('link_generated', req.user, {
            fromStatus: previous, toStatus: 'sent', remarks: `Source: ${source}`,
        });
        await vendor.save();

        res.status(201).json({
            success: true,
            message: 'KYC link generated. Share it with the vendor to collect their details.',
            data: {
                kycLink: publicKycUrl(vendor.kycToken),
                kycStatus: vendor.kycStatus,
                kycSource: vendor.kycSource,
                expiresAt: vendor.kycTokenExpiresAt,
                vendor: vendor.toSafeJSON(),
            },
        });
    } catch (error) {
        console.error('Create KYC request error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    List vendors — shared between Purchase and Finance (no department filter)
// @route   GET /api/vendors
// @access  Private (purchase, finance, admin)
exports.getVendors = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const { search, kycStatus, kycSource, page = 1, limit = 1000 } = req.query;

        // Deliberately NOT department-scoped: Purchase and Finance work the same
        // vendor records rather than keeping duplicates.
        const filter = { isActive: true };
        if (kycStatus) filter.kycStatus = kycStatus;
        if (kycSource) filter.kycSource = kycSource;
        if (search && search.trim()) {
            const rx = new RegExp(escapeRegex(search.trim()), 'i');
            filter.$or = [
                { vendorName: rx }, { companyName: rx }, { contactPerson: rx },
                { email: rx }, { phone: rx }, { gstNumber: rx }, { panNumber: rx },
            ];
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);

        const [vendors, total] = await Promise.all([
            Vendor.find(filter)
                .populate('createdBy', 'name username')
                .populate('financeReview.reviewedBy', 'name username')
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            Vendor.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            data: vendors.map((v) => v.toSafeJSON()),
            pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum), totalRecords: total },
        });
    } catch (error) {
        console.error('Get vendors error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Vendor / KYC statistics — powers both dashboards
// @route   GET /api/vendors/stats
// @access  Private (purchase, finance, admin)
exports.getVendorStats = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const base = { isActive: true };
        const [byStatus, bySource, total, recentSubmitted, recentReviewed] = await Promise.all([
            Vendor.aggregate([{ $match: base }, { $group: { _id: '$kycStatus', count: { $sum: 1 } } }]),
            Vendor.aggregate([{ $match: base }, { $group: { _id: '$kycSource', count: { $sum: 1 } } }]),
            Vendor.countDocuments(base),
            Vendor.find({ ...base, kycStatus: { $in: ['submitted', 'under_review'] } })
                .sort({ kycSubmittedAt: -1 }).limit(10)
                .select('vendorName companyName kycStatus kycSource kycSubmittedAt'),
            Vendor.find({ ...base, kycStatus: { $in: ['approved', 'rejected'] } })
                .sort({ 'financeReview.reviewedAt': -1 }).limit(10)
                .select('vendorName companyName kycStatus financeReview'),
        ]);

        const statusCounts = {
            not_sent: 0, sent: 0, submitted: 0, under_review: 0, approved: 0, rejected: 0,
        };
        byStatus.forEach((s) => { if (s._id) statusCounts[s._id] = s.count; });

        const sourceCounts = { purchase: 0, finance: 0 };
        bySource.forEach((s) => { if (s._id) sourceCounts[s._id] = s.count; });

        res.status(200).json({
            success: true,
            data: {
                total,
                ...statusCounts,
                // Anything Finance still has to act on
                awaitingReview: statusCounts.submitted + statusCounts.under_review,
                bySource: sourceCounts,
                recentSubmitted,
                recentApprovals: recentReviewed.filter((v) => v.kycStatus === 'approved'),
                recentRejections: recentReviewed.filter((v) => v.kycStatus === 'rejected'),
            },
        });
    } catch (error) {
        console.error('Get vendor stats error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Get a single vendor, including KYC documents and history
// @route   GET /api/vendors/:id
// @access  Private (purchase, finance, admin)
exports.getVendor = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const vendor = await Vendor.findById(req.params.id)
            .populate('createdBy', 'name username')
            .populate('financeReview.reviewedBy', 'name username')
            .populate('kycHistory.byUser', 'name username');

        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

        // Documents come back with short-lived signed view/download URLs. The
        // permission check above is what authorises issuing them — a raw
        // Cloudinary URL on its own will not fetch the file.
        const safe = withSignedDocuments(vendor);

        // Whoever can manage the vendor may also retrieve the live link to re-share
        if (canGenerateKycLink(req.user) && vendor.kycToken) {
            safe.kycLink = publicKycUrl(vendor.kycToken);
        }

        res.status(200).json({ success: true, data: safe });
    } catch (error) {
        console.error('Get vendor error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Update vendor details
// @route   PUT /api/vendors/:id
// @access  Private (admin, purchase_manager, finance)
exports.updateVendor = async (req, res) => {
    try {
        if (denyUnlessCanEdit(req, res)) return;

        const vendor = await Vendor.findById(req.params.id);
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

        EDITABLE.forEach((f) => {
            if (req.body[f] !== undefined) vendor[f] = req.body[f];
        });
        vendor.logKyc('updated', req.user);
        await vendor.save();

        res.status(200).json({
            success: true,
            message: 'Vendor updated successfully',
            data: vendor.toSafeJSON(),
        });
    } catch (error) {
        console.error('Update vendor error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Soft-delete a vendor (Admin only)
// @route   DELETE /api/vendors/:id
// @access  Private/Admin
exports.deleteVendor = async (req, res) => {
    try {
        const vendor = await Vendor.findById(req.params.id);
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        vendor.isActive = false;
        await vendor.save();
        res.status(200).json({ success: true, message: 'Vendor deleted successfully' });
    } catch (error) {
        console.error('Delete vendor error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Generate (or regenerate) the vendor's public KYC form link.
//          The generating department is recorded as the KYC source.
// @route   POST /api/vendors/:id/kyc-link
// @access  Private (admin, purchase_manager, finance)
exports.generateKycLink = async (req, res) => {
    try {
        if (denyUnlessCanGenerateLink(req, res)) return;

        const vendor = await Vendor.findById(req.params.id);
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

        // An approved vendor should not be silently re-opened for editing.
        // Regenerating is allowed, but it is an explicit act that resets status.
        const wasApproved = vendor.kycStatus === 'approved';
        if (wasApproved && !req.body.confirmReset) {
            return res.status(400).json({
                success: false,
                message: 'This vendor is already approved. Re-send the KYC form only if you intend to reset its approved status.',
                requiresConfirmation: true,
            });
        }

        const previous = vendor.kycStatus;
        vendor.kycToken = Vendor.generateToken();
        vendor.kycTokenGeneratedAt = new Date();
        vendor.kycTokenExpiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000);
        vendor.kycStatus = 'sent';
        vendor.kycLinkSentAt = new Date();
        // Source = the department of whoever generated the link
        vendor.kycSource = isFinanceUser(req.user) ? 'finance' : 'purchase';
        vendor.kycSourceUser = req.user.id;
        vendor.kycSourceUserName = req.user.name;

        // A regenerated link invalidates the previous review
        if (previous === 'approved' || previous === 'rejected') {
            vendor.financeReview = { decision: null, remarks: '', reviewedBy: null, reviewedByName: '', reviewedAt: null };
            vendor.logKyc('reset', req.user, { fromStatus: previous, toStatus: 'sent' });
        }
        vendor.logKyc('link_generated', req.user, {
            fromStatus: previous, toStatus: 'sent',
            remarks: `Source: ${vendor.kycSource}`,
        });
        await vendor.save();

        res.status(200).json({
            success: true,
            message: 'KYC link generated',
            data: {
                kycLink: publicKycUrl(vendor.kycToken),
                kycStatus: vendor.kycStatus,
                kycSource: vendor.kycSource,
                expiresAt: vendor.kycTokenExpiresAt,
                vendor: vendor.toSafeJSON(),
            },
        });
    } catch (error) {
        console.error('Generate KYC link error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Record that the KYC link was shared with the vendor
// @route   POST /api/vendors/:id/kyc-link/sent
// @access  Private (admin, purchase_manager, finance)
exports.markKycLinkSent = async (req, res) => {
    try {
        if (denyUnlessCanGenerateLink(req, res)) return;

        const vendor = await Vendor.findById(req.params.id);
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        if (!vendor.kycToken) {
            return res.status(400).json({ success: false, message: 'Generate a KYC link first' });
        }

        vendor.kycLinkSentAt = new Date();
        if (vendor.kycStatus === 'not_sent') vendor.kycStatus = 'sent';
        vendor.logKyc('link_sent', req.user, {
            toStatus: vendor.kycStatus,
            remarks: req.body.method ? `Shared via ${req.body.method}` : undefined,
        });
        await vendor.save();

        res.status(200).json({ success: true, message: 'Marked as sent', data: vendor.toSafeJSON() });
    } catch (error) {
        console.error('Mark KYC link sent error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Move a submitted KYC into "Under Review" (Finance only)
// @route   POST /api/vendors/:id/kyc/review
// @access  Private (admin, finance)
exports.startKycReview = async (req, res) => {
    try {
        if (!canReviewKyc(req.user)) {
            return res.status(403).json({
                success: false,
                message: 'Only the Finance department can review vendor KYC',
            });
        }

        const vendor = await Vendor.findById(req.params.id);
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        if (vendor.kycStatus !== 'submitted') {
            return res.status(400).json({
                success: false,
                message: `KYC cannot be moved to review from "${vendor.kycStatus}"`,
            });
        }

        vendor.kycStatus = 'under_review';
        vendor.logKyc('under_review', req.user, { fromStatus: 'submitted', toStatus: 'under_review' });
        await vendor.save();

        res.status(200).json({ success: true, message: 'KYC moved to Under Review', data: vendor.toSafeJSON() });
    } catch (error) {
        console.error('Start KYC review error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Approve or reject a vendor's KYC. FINANCE ONLY — Purchase users,
//          including Purchase Managers, are deliberately refused here.
// @route   POST /api/vendors/:id/kyc/decision
// @access  Private (admin, finance)
exports.decideKyc = async (req, res) => {
    try {
        if (!canReviewKyc(req.user)) {
            return res.status(403).json({
                success: false,
                message: 'Only the Finance department can approve or reject vendor KYC',
            });
        }

        const { decision, remarks } = req.body;
        if (!['approved', 'rejected'].includes(decision)) {
            return res.status(400).json({ success: false, message: 'Decision must be "approved" or "rejected"' });
        }
        if (decision === 'rejected' && !(remarks || '').trim()) {
            return res.status(400).json({ success: false, message: 'A reason is required when rejecting a KYC' });
        }

        const vendor = await Vendor.findById(req.params.id);
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        if (!['submitted', 'under_review'].includes(vendor.kycStatus)) {
            return res.status(400).json({
                success: false,
                message: `Only a submitted KYC can be decided. Current status: "${vendor.kycStatus}".`,
            });
        }

        const from = vendor.kycStatus;
        vendor.kycStatus = decision;
        vendor.financeReview = {
            reviewedBy: req.user.id,
            reviewedByName: req.user.name,
            reviewedAt: new Date(),
            decision,
            remarks: (remarks || '').trim(),
        };
        vendor.logKyc(decision, req.user, { fromStatus: from, toStatus: decision, remarks: (remarks || '').trim() });
        await vendor.save();

        // Tell Purchase the outcome
        await notifyRoles(PURCHASE_ROLES, {
            type: decision === 'approved' ? 'vendor_kyc_approved' : 'vendor_kyc_rejected',
            vendor: vendor._id,
            companyName: vendor.companyName || vendor.vendorName,
            salesPerson: req.user.id,
            salesPersonName: req.user.name,
            remark: decision === 'rejected' ? vendor.financeReview.remarks : 'Vendor is approved for transactions',
            department: 'purchase',
        });
        // And mirror it to admins
        await notify({
            type: decision === 'approved' ? 'vendor_kyc_approved' : 'vendor_kyc_rejected',
            vendor: vendor._id,
            companyName: vendor.companyName || vendor.vendorName,
            salesPersonName: req.user.name,
            remark: vendor.financeReview.remarks,
            forRole: 'admin',
            department: 'purchase',
        });

        res.status(200).json({
            success: true,
            message: `Vendor KYC ${decision}`,
            data: vendor.toSafeJSON(),
        });
    } catch (error) {
        console.error('Decide KYC error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

module.exports.publicKycUrl = publicKycUrl;
module.exports.notifyRoles = notifyRoles;
module.exports.TOKEN_TTL_DAYS = TOKEN_TTL_DAYS;
