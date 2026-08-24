const RateComparison = require('../models/RateComparison');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Notification = require('../models/Notification');
const {
    canManageRateComparisons, canApproveRateComparisons,
    isAdminLevel, PURCHASE_ROLES, ADMIN_LEVEL_ROLES,
} = require('../utils/department');
const rcService = require('../services/rateComparisonService');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const denyUnlessCanManage = (req, res) => {
    if (canManageRateComparisons(req.user)) return false;
    res.status(403).json({ success: false, message: 'You do not have access to rate comparisons' });
    return true;
};

const denyUnlessCanApprove = (req, res) => {
    if (canApproveRateComparisons(req.user)) return false;
    res.status(403).json({
        success: false,
        message: 'Only the Director or an Admin can approve, reject or send back a rate comparison',
    });
    return true;
};

// Fire-and-forget — a notification failure must never break the request.
const notify = async (payload) => {
    try {
        await Notification.create({ department: 'purchase', ...payload });
    } catch (err) {
        console.error('Rate comparison notification failed:', err.message);
    }
};

const notifyRoles = async (roles, payload) => {
    try {
        const users = await User.find({ role: { $in: roles }, isActive: true }).select('_id role');
        await Promise.all(users.map((u) => notify({ ...payload, forUser: u._id, forRole: u.role })));
    } catch (err) {
        console.error('Rate comparison role notification failed:', err.message);
    }
};

// Resolve vendor names for the supplied quotation rows in one query
const vendorNameMap = async (rows) => {
    const ids = [...new Set((rows || []).map((q) => q.vendor).filter(Boolean))];
    if (!ids.length) return {};
    const vendors = await Vendor.find({ _id: { $in: ids }, isActive: true }).select('vendorName');
    return vendors.reduce((acc, v) => { acc[String(v._id)] = v.vendorName; return acc; }, {});
};

// `materialDescription` was removed from the Rate Comparison form. The schema
// keeps it so existing comparisons retain their text, but it is no longer
// writable from the UI.
const EDITABLE = ['comparisonDate', 'materialName', 'requiredQuantity', 'unit', 'comparisonRemarks'];

// Attach the derived comparison summary to a response
const decorate = (doc) => {
    const obj = doc.toObject ? doc.toObject() : doc;
    obj.summary = rcService.buildComparisonSummary(obj);
    obj.canEdit = rcService.canEdit(obj);
    return obj;
};

// @desc    Create a rate comparison
// @route   POST /api/rate-comparisons
// @access  Private (purchase, admin, director)
exports.createRateComparison = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const nameMap = await vendorNameMap(req.body.quotations);
        const quotations = rcService.normaliseQuotations(req.body.quotations, nameMap);
        const problems = rcService.validateComparison(req.body, quotations, false);
        if (problems.length) {
            return res.status(400).json({ success: false, message: 'Please correct the highlighted fields', errors: problems });
        }

        const rc = new RateComparison({
            comparisonNumber: await RateComparison.nextComparisonNumber(),
            comparisonDate: req.body.comparisonDate || new Date(),
            materialName: req.body.materialName,
            requiredQuantity: Number(req.body.requiredQuantity) || 0,
            unit: req.body.unit,
            quotations,
            comparisonRemarks: req.body.comparisonRemarks,
            status: 'draft',
            department: 'purchase',
            createdBy: req.user.id,
            createdByName: req.user.name,
        });
        rc.log('created', req.user, { toStatus: 'draft', remarks: `${quotations.length} quotation(s)` });
        await rc.save();

        res.status(201).json({ success: true, message: 'Rate comparison created', data: decorate(rc) });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'That comparison number was just taken. Please try again.' });
        }
        console.error('Create rate comparison error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    List rate comparisons
// @route   GET /api/rate-comparisons
// @access  Private (purchase, admin, director)
exports.getRateComparisons = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const { search, status, page = 1, limit = 1000 } = req.query;
        const filter = { isActive: true };
        if (status) filter.status = status;
        if (search && search.trim()) {
            const rx = new RegExp(escapeRegex(search.trim()), 'i');
            filter.$or = [
                { comparisonNumber: rx }, { materialName: rx },
                { selectedVendorName: rx }, { 'quotations.vendorName': rx },
            ];
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);

        const [items, total] = await Promise.all([
            RateComparison.find(filter)
                .populate('createdBy', 'name username')
                .populate('directorReview.reviewedBy', 'name username')
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            RateComparison.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            data: items.map(decorate),
            pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum), totalRecords: total },
        });
    } catch (error) {
        console.error('Get rate comparisons error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Rate comparison statistics — powers the Purchase and Director views
// @route   GET /api/rate-comparisons/stats
// @access  Private (purchase, admin, director)
exports.getRateComparisonStats = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const base = { isActive: true };
        const [byStatus, pending, recentDecisions] = await Promise.all([
            RateComparison.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            RateComparison.find({ ...base, status: 'pending_approval' })
                .sort({ submittedAt: -1 }).limit(10)
                .select('comparisonNumber materialName requiredQuantity unit selectedVendorName submittedByName submittedAt quotations'),
            RateComparison.find({ ...base, status: { $in: ['approved', 'rejected', 'sent_back'] } })
                .sort({ 'directorReview.reviewedAt': -1 }).limit(10)
                .select('comparisonNumber materialName status directorReview selectedVendorName'),
        ]);

        const counts = { draft: 0, pending_approval: 0, approved: 0, rejected: 0, sent_back: 0, cancelled: 0 };
        byStatus.forEach((s) => { if (s._id) counts[s._id] = s.count; });

        res.status(200).json({
            success: true,
            data: {
                total: Object.values(counts).reduce((a, b) => a + b, 0),
                ...counts,
                awaitingDirector: counts.pending_approval,
                pending: pending.map((p) => ({
                    _id: p._id,
                    comparisonNumber: p.comparisonNumber,
                    materialName: p.materialName,
                    requiredQuantity: p.requiredQuantity,
                    unit: p.unit,
                    selectedVendorName: p.selectedVendorName,
                    submittedByName: p.submittedByName,
                    submittedAt: p.submittedAt,
                    vendorCount: (p.quotations || []).length,
                })),
                recentDecisions,
            },
        });
    } catch (error) {
        console.error('Get rate comparison stats error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Get one rate comparison
// @route   GET /api/rate-comparisons/:id
// @access  Private (purchase, admin, director)
exports.getRateComparison = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const rc = await RateComparison.findById(req.params.id)
            .populate('createdBy', 'name username')
            .populate('submittedBy', 'name username')
            .populate('directorReview.reviewedBy', 'name username')
            .populate('quotations.vendor', 'vendorName companyName email kycStatus')
            .populate('purchaseOrder', 'poNumber status totalAmount');
        if (!rc) return res.status(404).json({ success: false, message: 'Rate comparison not found' });

        res.status(200).json({ success: true, data: decorate(rc) });
    } catch (error) {
        console.error('Get rate comparison error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Update a rate comparison (only while draft or sent back)
// @route   PUT /api/rate-comparisons/:id
// @access  Private (purchase, admin, director)
exports.updateRateComparison = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const rc = await RateComparison.findById(req.params.id);
        if (!rc) return res.status(404).json({ success: false, message: 'Rate comparison not found' });

        if (!rcService.canEdit(rc)) {
            return res.status(400).json({
                success: false,
                message: `A "${rc.status.replace(/_/g, ' ')}" rate comparison can no longer be edited.`,
            });
        }

        EDITABLE.forEach((f) => {
            if (req.body[f] !== undefined) rc[f] = req.body[f];
        });

        if (req.body.quotations !== undefined) {
            const nameMap = await vendorNameMap(req.body.quotations);
            rc.quotations = rcService.normaliseQuotations(req.body.quotations, nameMap);
        }

        const problems = rcService.validateComparison(
            { materialName: rc.materialName, requiredQuantity: rc.requiredQuantity },
            rc.quotations, false
        );
        if (problems.length) {
            return res.status(400).json({ success: false, message: 'Please correct the highlighted fields', errors: problems });
        }

        rc.log('updated', req.user);
        await rc.save();

        res.status(200).json({ success: true, message: 'Rate comparison updated', data: decorate(rc) });
    } catch (error) {
        console.error('Update rate comparison error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Submit a rate comparison to the Director for approval
// @route   POST /api/rate-comparisons/:id/submit
// @access  Private (purchase, admin, director)
exports.submitForApproval = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const rc = await RateComparison.findById(req.params.id);
        if (!rc) return res.status(404).json({ success: false, message: 'Rate comparison not found' });

        if (!rcService.allowedTransitions(rc.status).includes('pending_approval')) {
            return res.status(400).json({
                success: false,
                message: `A "${rc.status.replace(/_/g, ' ')}" rate comparison cannot be submitted.`,
            });
        }

        const problems = rcService.validateComparison(
            { materialName: rc.materialName, requiredQuantity: rc.requiredQuantity },
            rc.quotations, true
        );
        if (problems.length) {
            return res.status(400).json({ success: false, message: 'This comparison is not ready to submit', errors: problems });
        }

        const isResubmission = rc.status === 'sent_back';
        const from = rc.status;

        rc.status = 'pending_approval';
        rc.submittedBy = req.user.id;
        rc.submittedByName = req.user.name;
        rc.submittedAt = new Date();
        if (isResubmission) rc.revisionCount += 1;
        // A fresh submission clears the previous decision
        rc.directorReview = { decision: null, remarks: '', reviewedBy: null, reviewedByName: '', reviewedAt: null };
        rc.log(isResubmission ? 'resubmitted' : 'submitted', req.user, {
            fromStatus: from, toStatus: 'pending_approval',
            remarks: isResubmission ? `Revision ${rc.revisionCount}` : undefined,
        });
        await rc.save();

        // Tell every administrator (Director and Admin share this authority)
        await notifyRoles(ADMIN_LEVEL_ROLES, {
            type: 'rate_comparison_submitted',
            rateComparison: rc._id,
            companyName: `${rc.materialName} (${rc.comparisonNumber})`,
            salesPerson: req.user.id,
            salesPersonName: req.user.name,
            remark: `${rc.quotations.length} vendor quotations • recommending ${rc.selectedVendorName || '—'}`,
        });

        res.status(200).json({
            success: true,
            message: isResubmission ? 'Rate comparison resubmitted to the Director' : 'Rate comparison submitted to the Director',
            data: decorate(rc),
        });
    } catch (error) {
        console.error('Submit rate comparison error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Director decision: approve / reject / send back
// @route   POST /api/rate-comparisons/:id/decision
// @access  Private (admin, director)
exports.decide = async (req, res) => {
    try {
        if (denyUnlessCanApprove(req, res)) return;

        const { decision, remarks } = req.body;
        if (!['approved', 'rejected', 'sent_back'].includes(decision)) {
            return res.status(400).json({ success: false, message: 'Decision must be "approved", "rejected" or "sent_back"' });
        }
        // A rejection or a request for changes is useless without a reason
        if (decision !== 'approved' && !String(remarks || '').trim()) {
            return res.status(400).json({
                success: false,
                message: decision === 'rejected'
                    ? 'A reason is required when rejecting a rate comparison'
                    : 'Explain what needs changing when sending a comparison back',
            });
        }

        const rc = await RateComparison.findById(req.params.id);
        if (!rc) return res.status(404).json({ success: false, message: 'Rate comparison not found' });

        if (!rcService.allowedTransitions(rc.status).includes(decision)) {
            return res.status(400).json({
                success: false,
                message: `Only a comparison awaiting approval can be decided. Current status: "${rc.status.replace(/_/g, ' ')}".`,
            });
        }

        const from = rc.status;
        rc.status = decision;
        rc.directorReview = {
            reviewedBy: req.user.id,
            reviewedByName: req.user.name,
            reviewedAt: new Date(),
            decision,
            remarks: String(remarks || '').trim(),
        };
        rc.log(decision, req.user, { fromStatus: from, toStatus: decision, remarks: rc.directorReview.remarks });
        await rc.save();

        const label = { approved: 'Approved', rejected: 'Rejected', sent_back: 'Sent Back' }[decision];
        // Tell the Purchase team, and the person who submitted it directly
        await notifyRoles(PURCHASE_ROLES, {
            type: `rate_comparison_${decision}`,
            rateComparison: rc._id,
            companyName: `${rc.materialName} (${rc.comparisonNumber})`,
            salesPerson: req.user.id,
            salesPersonName: req.user.name,
            remark: rc.directorReview.remarks || (decision === 'approved' ? 'You can now raise the purchase order' : ''),
        });
        if (rc.submittedBy && !PURCHASE_ROLES.includes(req.user.role)) {
            await notify({
                type: `rate_comparison_${decision}`,
                rateComparison: rc._id,
                companyName: `${rc.materialName} (${rc.comparisonNumber})`,
                salesPersonName: req.user.name,
                remark: rc.directorReview.remarks,
                forUser: rc.submittedBy,
            });
        }

        res.status(200).json({ success: true, message: `Rate comparison ${label.toLowerCase()}`, data: decorate(rc) });
    } catch (error) {
        console.error('Decide rate comparison error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Soft-delete / cancel a rate comparison (Admin or Director)
// @route   DELETE /api/rate-comparisons/:id
// @access  Private (admin, director)
exports.deleteRateComparison = async (req, res) => {
    try {
        const rc = await RateComparison.findById(req.params.id);
        if (!rc) return res.status(404).json({ success: false, message: 'Rate comparison not found' });
        rc.isActive = false;
        rc.log('cancelled', req.user, { fromStatus: rc.status, toStatus: 'cancelled' });
        await rc.save();
        res.status(200).json({ success: true, message: 'Rate comparison deleted' });
    } catch (error) {
        console.error('Delete rate comparison error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
