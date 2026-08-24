const PurchaseOrder = require('../models/PurchaseOrder');
const Vendor = require('../models/Vendor');
const RateComparison = require('../models/RateComparison');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const { canManagePurchaseOrders, isPurchaseUser, isAdminLevel } = require('../utils/department');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Purchase staff may view POs; only the Purchase Manager and Admin may write.
const canView = (user) => isAdminLevel(user) || isPurchaseUser(user);

const denyUnlessCanView = (req, res) => {
    if (canView(req.user)) return false;
    res.status(403).json({ success: false, message: 'You do not have access to purchase orders' });
    return true;
};

const denyUnlessCanManage = (req, res) => {
    if (canManagePurchaseOrders(req.user)) return false;
    res.status(403).json({
        success: false,
        message: 'Only the Purchase Manager or an Admin can create or modify purchase orders',
    });
    return true;
};

const notify = async (payload) => {
    try {
        await Notification.create({ department: 'purchase', ...payload });
    } catch (err) {
        console.error('PO notification failed:', err.message);
    }
};

// Normalise incoming item lines; amounts are recomputed by the model's hook.
const normaliseItems = (items) =>
    (Array.isArray(items) ? items : [])
        .filter((l) => l && String(l.itemName || '').trim())
        .map((l) => ({
            itemName: String(l.itemName).trim(),
            quantity: Number(l.quantity) || 0,
            unit: (l.unit || '').trim(),
            rate: Number(l.rate) || 0,
        }));

// `notes` and `termsAndConditions` were removed from the PO form. The schema
// keeps both so existing orders retain their content, but neither is writable
// any more — point-wise `terms` replaced the free-text block.
const EDITABLE = [
    'poDate', 'deliveryLocation', 'expectedDeliveryDate',
    'paymentTerms', 'taxPercent', 'discount',
];

// Normalise the point-wise terms: trim, drop blanks, de-duplicate
// case-insensitively, and cap the list at a sane length.
const normaliseTerms = (terms) => {
    if (!Array.isArray(terms)) return undefined;
    const seen = new Set();
    return terms
        .map((t) => String(typeof t === 'string' ? t : t?.text || '').trim())
        .filter((t) => {
            if (!t) return false;
            const key = t.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 50);
};

// @desc    Create a purchase order
// @route   POST /api/purchase-orders
// @access  Private (admin, purchase_manager)
exports.createPurchaseOrder = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }
        if (denyUnlessCanManage(req, res)) return;

        const vendor = await Vendor.findById(req.body.vendor);
        if (!vendor || !vendor.isActive) {
            return res.status(400).json({ success: false, message: 'Select a valid vendor' });
        }

        const items = normaliseItems(req.body.items);
        if (!items.length) {
            return res.status(400).json({ success: false, message: 'Add at least one item to the purchase order' });
        }

        // A PO may be raised from an approved Rate Comparison. When one is
        // supplied it must be Director-approved, must not already have produced
        // a PO, and its selected vendor must be the vendor on this PO — that is
        // what makes the approval meaningful rather than decorative.
        let rateComparison = null;
        if (req.body.rateComparison) {
            rateComparison = await RateComparison.findById(req.body.rateComparison);
            if (!rateComparison || !rateComparison.isActive) {
                return res.status(400).json({ success: false, message: 'That rate comparison could not be found' });
            }
            const gate = rateComparison.canRaisePurchaseOrder();
            if (!gate.ok) {
                return res.status(400).json({ success: false, message: gate.message });
            }
            if (String(rateComparison.selectedVendor) !== String(vendor._id)) {
                return res.status(400).json({
                    success: false,
                    message: `The Director approved ${rateComparison.selectedVendorName} on ${rateComparison.comparisonNumber}. Raise the purchase order for that vendor, or send a new comparison for approval.`,
                });
            }
        }

        const po = new PurchaseOrder({
            poNumber: await PurchaseOrder.nextPoNumber(),
            poDate: req.body.poDate || new Date(),
            vendor: vendor._id,
            vendorName: vendor.vendorName,
            vendorEmail: vendor.email,
            vendorGst: vendor.gstNumber,
            rateComparison: rateComparison ? rateComparison._id : undefined,
            rateComparisonNumber: rateComparison ? rateComparison.comparisonNumber : undefined,
            items,
            taxPercent: Number(req.body.taxPercent) || 0,
            discount: Number(req.body.discount) || 0,
            deliveryLocation: req.body.deliveryLocation,
            expectedDeliveryDate: req.body.expectedDeliveryDate || undefined,
            paymentTerms: req.body.paymentTerms || vendor.paymentTerms,
            terms: normaliseTerms(req.body.terms) || [],
            status: req.body.status === 'generated' ? 'generated' : 'draft',
            department: 'purchase',
            createdBy: req.user.id,
            createdByName: req.user.name,
        });
        po.logActivity('created', req.user, `PO raised for ${vendor.vendorName}`);
        if (po.status === 'generated') po.logActivity('generated', req.user);
        await po.save();

        // Close the loop so the comparison shows which PO it produced, and can
        // never be spent twice.
        if (rateComparison) {
            rateComparison.purchaseOrder = po._id;
            rateComparison.poNumber = po.poNumber;
            rateComparison.log('po_created', req.user, { remarks: `${po.poNumber} raised for ${vendor.vendorName}` });
            await rateComparison.save();
        }

        await notify({
            type: 'po_created',
            purchaseOrder: po._id,
            vendor: vendor._id,
            companyName: vendor.vendorName,
            salesPerson: req.user.id,
            salesPersonName: req.user.name,
            remark: `${po.poNumber} • ₹${po.totalAmount.toLocaleString('en-IN')}`,
            forRole: 'admin',
        });

        const populated = await PurchaseOrder.findById(po._id)
            .populate('vendor', 'vendorName companyName email kycStatus')
            .populate('createdBy', 'name username');

        res.status(201).json({ success: true, message: 'Purchase order created', data: populated });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'That PO number was just taken. Please try again.',
            });
        }
        console.error('Create PO error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    List purchase orders with search and filters
// @route   GET /api/purchase-orders
// @access  Private (purchase, admin)
exports.getPurchaseOrders = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const { search, status, vendor, page = 1, limit = 1000 } = req.query;
        const filter = { isActive: true };
        if (status) filter.status = status;
        if (vendor) filter.vendor = vendor;
        if (search && search.trim()) {
            const rx = new RegExp(escapeRegex(search.trim()), 'i');
            filter.$or = [{ poNumber: rx }, { vendorName: rx }, { 'items.itemName': rx }];
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);

        const [orders, total] = await Promise.all([
            PurchaseOrder.find(filter)
                .populate('vendor', 'vendorName companyName email kycStatus')
                .populate('rateComparison', 'comparisonNumber status selectedVendorName')
                .populate('createdBy', 'name username')
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            PurchaseOrder.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            data: orders,
            pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum), totalRecords: total },
        });
    } catch (error) {
        console.error('Get POs error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Purchase order statistics
// @route   GET /api/purchase-orders/stats
// @access  Private (purchase, admin)
exports.getPurchaseOrderStats = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const base = { isActive: true };
        const [byStatus, totals, recent] = await Promise.all([
            PurchaseOrder.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            PurchaseOrder.aggregate([
                { $match: base },
                { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$totalAmount' } } },
            ]),
            PurchaseOrder.find(base).sort({ createdAt: -1 }).limit(8)
                .select('poNumber poDate vendorName totalAmount status createdByName'),
        ]);

        const statusCounts = { draft: 0, generated: 0, sent: 0, acknowledged: 0, completed: 0, cancelled: 0 };
        byStatus.forEach((s) => { if (s._id) statusCounts[s._id] = s.count; });

        res.status(200).json({
            success: true,
            data: {
                total: totals[0]?.count || 0,
                totalValue: totals[0]?.value || 0,
                ...statusCounts,
                recent,
            },
        });
    } catch (error) {
        console.error('Get PO stats error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Terms & conditions used on previous purchase orders, so a Purchase
//          Manager can reuse them instead of retyping. Ranked by how often each
//          has been used and de-duplicated case-insensitively.
// @route   GET /api/purchase-orders/terms-suggestions
// @access  Private (purchase, admin)
exports.getTermsSuggestions = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const rows = await PurchaseOrder.aggregate([
            { $match: { isActive: true, terms: { $exists: true, $ne: [] } } },
            { $unwind: '$terms' },
            { $group: { _id: { $toLower: '$terms' }, text: { $first: '$terms' }, uses: { $sum: 1 } } },
            { $sort: { uses: -1, _id: 1 } },
            { $limit: 40 },
        ]);

        res.status(200).json({
            success: true,
            data: rows.map((r) => ({ text: r.text, uses: r.uses })),
        });
    } catch (error) {
        console.error('Get terms suggestions error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Get one purchase order
// @route   GET /api/purchase-orders/:id
// @access  Private (purchase, admin)
exports.getPurchaseOrder = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const po = await PurchaseOrder.findById(req.params.id)
            .populate('vendor')
            .populate('rateComparison', 'comparisonNumber status selectedVendorName directorReview comparisonDate')
            .populate('createdBy', 'name username')
            .populate('sentBy', 'name username');
        if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });

        res.status(200).json({ success: true, data: po });
    } catch (error) {
        console.error('Get PO error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Update a purchase order (only before it has been sent)
// @route   PUT /api/purchase-orders/:id
// @access  Private (admin, purchase_manager)
exports.updatePurchaseOrder = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const po = await PurchaseOrder.findById(req.params.id);
        if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });

        // Once a PO has gone to the vendor it becomes a record, not a draft.
        if (['sent', 'acknowledged', 'completed', 'cancelled'].includes(po.status) && !isAdminLevel(req.user)) {
            return res.status(400).json({
                success: false,
                message: `A "${po.status}" purchase order can no longer be edited.`,
            });
        }

        EDITABLE.forEach((f) => {
            if (req.body[f] !== undefined) po[f] = req.body[f];
        });
        if (req.body.terms !== undefined) {
            po.terms = normaliseTerms(req.body.terms) || [];
        }
        if (req.body.items !== undefined) {
            const items = normaliseItems(req.body.items);
            if (!items.length) {
                return res.status(400).json({ success: false, message: 'A purchase order needs at least one item' });
            }
            po.items = items;
        }
        if (req.body.vendor && String(req.body.vendor) !== String(po.vendor)) {
            const vendor = await Vendor.findById(req.body.vendor);
            if (!vendor || !vendor.isActive) {
                return res.status(400).json({ success: false, message: 'Select a valid vendor' });
            }
            po.vendor = vendor._id;
            po.vendorName = vendor.vendorName;
            po.vendorEmail = vendor.email;
            po.vendorGst = vendor.gstNumber;
        }

        po.logActivity('updated', req.user);
        await po.save();

        const populated = await PurchaseOrder.findById(po._id)
            .populate('vendor', 'vendorName companyName email kycStatus')
            .populate('createdBy', 'name username');

        res.status(200).json({ success: true, message: 'Purchase order updated', data: populated });
    } catch (error) {
        console.error('Update PO error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Change a PO's status (generate / send / acknowledge / complete / cancel)
// @route   POST /api/purchase-orders/:id/status
// @access  Private (admin, purchase_manager)
exports.setPurchaseOrderStatus = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const { status, sentTo, sentMethod, note } = req.body;
        const allowed = ['generated', 'sent', 'acknowledged', 'completed', 'cancelled'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });
        }

        const po = await PurchaseOrder.findById(req.params.id).populate('vendor', 'vendorName email');
        if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });

        po.status = status;
        if (status === 'sent') {
            po.sentAt = new Date();
            po.sentTo = sentTo || po.vendorEmail || po.vendor?.email;
            po.sentMethod = sentMethod || 'email';
            po.sentBy = req.user.id;
            po.sentByName = req.user.name;
        }
        po.logActivity(status, req.user, note);
        await po.save();

        if (status === 'sent') {
            await notify({
                type: 'po_sent',
                purchaseOrder: po._id,
                vendor: po.vendor?._id,
                companyName: po.vendorName,
                salesPerson: req.user.id,
                salesPersonName: req.user.name,
                remark: `${po.poNumber} sent to ${po.sentTo || 'vendor'}`,
                forRole: 'admin',
            });
        }

        res.status(200).json({ success: true, message: `Purchase order marked "${status}"`, data: po });
    } catch (error) {
        console.error('Set PO status error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Soft-delete a purchase order (Admin only)
// @route   DELETE /api/purchase-orders/:id
// @access  Private/Admin
exports.deletePurchaseOrder = async (req, res) => {
    try {
        const po = await PurchaseOrder.findById(req.params.id);
        if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });
        po.isActive = false;
        await po.save();
        res.status(200).json({ success: true, message: 'Purchase order deleted' });
    } catch (error) {
        console.error('Delete PO error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
