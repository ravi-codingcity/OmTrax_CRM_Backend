const PurchaseOrder = require('../models/PurchaseOrder');
const { PO_STATUSES, LEGACY_SENT_STATUSES } = PurchaseOrder;
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

// Write responses carry the same shape as GET /:id — the full vendor included —
// so the UI can show the saved order, and print it, without a stale copy.
const populateForResponse = (query) => query
    .populate('vendor')
    .populate('rateComparison', 'comparisonNumber status selectedVendorName directorReview comparisonDate')
    .populate('createdBy', 'name username');

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

// Normalise the point-wise terms: trim, collapse repeated spaces, drop blanks,
// de-duplicate case-insensitively, and cap the list at a sane length.
const normaliseTerms = (terms) => {
    if (!Array.isArray(terms)) return undefined;
    const seen = new Set();
    return terms
        .map((t) => String(typeof t === 'string' ? t : t?.text || '').replace(/\s+/g, ' ').trim())
        .filter((t) => {
            if (!t) return false;
            const key = termKey(t);
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

        const statusCounts = Object.fromEntries(PO_STATUSES.map((st) => [st, 0]));
        byStatus.forEach((s) => {
            if (!s._id) return;
            // Orders left over from the retired send workflow count as generated
            const key = LEGACY_SENT_STATUSES.includes(s._id) ? 'generated' : s._id;
            if (key in statusCounts) statusCounts[key] += s.count;
        });

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

// Key used to decide two terms are the same condition: case, runs of spaces and
// trailing punctuation do not make a term different.
const termKey = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s.,;:]+$/, '');

// How well a saved term matches what is being typed. 0 = no match.
const matchScore = (term, query) => {
    const text = termKey(term);
    const q = termKey(query);
    if (!q) return 1;
    if (text === q) return 0;                        // already typed in full
    if (text.startsWith(q)) return 400;
    const words = q.split(' ').filter(Boolean);
    if (text.includes(q)) {
        // A match at the start of a word ranks above one inside a word
        return new RegExp(`(^|[^a-z0-9])${escapeRegex(q)}`).test(text) ? 300 : 200;
    }
    // Every typed word appears somewhere, in any order
    if (words.length > 1 && words.every((w) => text.includes(w))) return 100;
    return 0;
};

// @desc    Terms & conditions saved on existing purchase orders, offered as
//          suggestions on the next one. Without `q` the most-used terms are
//          returned; with `q` every saved term is searched and the best matches
//          come back ranked by closeness, then by how often each has been used.
//          Identical terms are merged into one suggestion.
// @route   GET /api/purchase-orders/terms-suggestions?q=&limit=
// @access  Private (purchase, admin)
exports.getTermsSuggestions = async (req, res) => {
    try {
        if (denyUnlessCanView(req, res)) return;

        const q = String(req.query.q || '').slice(0, 200);
        const searching = termKey(q).length > 0;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || (searching ? 10 : 40), 1), 50);

        const rows = await PurchaseOrder.aggregate([
            { $match: { isActive: true, terms: { $exists: true, $ne: [] } } },
            // Count each term once per purchase order
            { $project: { terms: { $setUnion: ['$terms', []] }, updatedAt: 1 } },
            { $unwind: '$terms' },
            { $group: { _id: '$terms', uses: { $sum: 1 }, lastUsed: { $max: '$updatedAt' } } },
        ]);

        // Merge identical conditions written with different case or spacing.
        // The wording used most often is the one offered.
        const merged = new Map();
        rows.forEach((r) => {
            const text = String(r._id || '').replace(/\s+/g, ' ').trim();
            const key = termKey(text);
            if (!key) return;
            const cur = merged.get(key);
            if (!cur) {
                merged.set(key, { text, uses: r.uses, lastUsed: r.lastUsed, best: r.uses });
                return;
            }
            cur.uses += r.uses;
            if (r.lastUsed > cur.lastUsed) cur.lastUsed = r.lastUsed;
            if (r.uses > cur.best) { cur.text = text; cur.best = r.uses; }
        });

        const data = [...merged.values()]
            .map((t) => ({ ...t, score: matchScore(t.text, q) }))
            .filter((t) => t.score > 0)
            .sort((a, b) => b.score - a.score
                || b.uses - a.uses
                || new Date(b.lastUsed || 0) - new Date(a.lastUsed || 0)
                || a.text.localeCompare(b.text))
            .slice(0, limit)
            .map(({ text, uses }) => ({ text, uses }));

        res.status(200).json({ success: true, data });
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
            .populate('createdBy', 'name username');
        if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });

        res.status(200).json({ success: true, data: po });
    } catch (error) {
        console.error('Get PO error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Human-readable names for the fields an edit can change, used in the history note
const FIELD_LABELS = {
    vendor: 'vendor', poDate: 'PO date', deliveryLocation: 'delivery location',
    expectedDeliveryDate: 'expected delivery', paymentTerms: 'payment terms',
    taxPercent: 'GST %', discount: 'discount', items: 'items', terms: 'terms & conditions',
};

const dayKey = (d) => {
    if (!d) return null;
    const x = new Date(d);
    return isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
};

// A comparable snapshot of everything an edit may change, so a save that alters
// nothing is not recorded as an edit.
const editableSnapshot = (po) => ({
    vendor: String(po.vendor?._id || po.vendor || ''),
    poDate: dayKey(po.poDate),
    deliveryLocation: po.deliveryLocation || '',
    expectedDeliveryDate: dayKey(po.expectedDeliveryDate),
    paymentTerms: po.paymentTerms || '',
    taxPercent: Number(po.taxPercent) || 0,
    discount: Number(po.discount) || 0,
    items: JSON.stringify((po.items || []).map((l) => [l.itemName, Number(l.quantity) || 0, l.unit || '', Number(l.rate) || 0])),
    terms: JSON.stringify(po.terms || []),
});

// Statuses in which a PO may still be corrected. A completed or cancelled order
// is a closed record; administrators keep their existing ability to amend it.
const EDITABLE_STATUSES = ['draft', 'generated'];

// @desc    Edit an existing purchase order. The same record is updated in place
//          (PO number, creation details and source comparison never change), and
//          the server stamps who edited it and when.
// @route   PUT /api/purchase-orders/:id
// @access  Private (admin, purchase_manager)
exports.updatePurchaseOrder = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const po = await PurchaseOrder.findById(req.params.id);
        if (!po || !po.isActive) return res.status(404).json({ success: false, message: 'Purchase order not found' });

        if (!EDITABLE_STATUSES.includes(po.status) && !LEGACY_SENT_STATUSES.includes(po.status) && !isAdminLevel(req.user)) {
            return res.status(400).json({
                success: false,
                message: `A "${po.status}" purchase order can no longer be edited.`,
            });
        }

        const before = editableSnapshot(po);

        // Only whitelisted fields are read from the request. lastEdited*, createdAt,
        // createdBy, poNumber, rateComparison and the totals are never taken from it.
        EDITABLE.forEach((f) => {
            if (req.body[f] !== undefined) po[f] = req.body[f];
        });
        if (req.body.expectedDeliveryDate === '' || req.body.expectedDeliveryDate === null) {
            po.expectedDeliveryDate = undefined;
        }
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
            // The Director approved a specific vendor on the source comparison;
            // editing the PO must not quietly swap it for another.
            if (po.rateComparison) {
                return res.status(400).json({
                    success: false,
                    message: `${po.poNumber} was raised from approved rate comparison ${po.rateComparisonNumber || ''}. Its vendor cannot be changed.`.replace(/\s+\./, '.'),
                });
            }
            const vendor = await Vendor.findById(req.body.vendor);
            if (!vendor || !vendor.isActive) {
                return res.status(400).json({ success: false, message: 'Select a valid vendor' });
            }
            po.vendor = vendor._id;
            po.vendorName = vendor.vendorName;
            po.vendorEmail = vendor.email;
            po.vendorGst = vendor.gstNumber;
        }

        const after = editableSnapshot(po);
        const changed = Object.keys(after).filter((k) => after[k] !== before[k]);

        // Saving a draft as a generated PO is part of the same action
        const generating = req.body.status === 'generated' && po.status === 'draft';

        if (!changed.length && !generating) {
            const unchanged = await populateForResponse(PurchaseOrder.findById(po._id));
            return res.status(200).json({ success: true, message: 'No changes to save', unchanged: true, data: unchanged });
        }

        if (changed.length) {
            po.logActivity('updated', req.user, `Edited ${changed.map((k) => FIELD_LABELS[k] || k).join(', ')}`);
            // Stamp from the activity entry just written, so the two always agree
            const entry = po.activity[po.activity.length - 1];
            po.lastEditedAt = entry.at;
            po.lastEditedBy = req.user.id;
            po.lastEditedByName = req.user.name;
        }
        if (generating) {
            po.status = 'generated';
            po.logActivity('generated', req.user);
        }
        await po.save();

        const populated = await populateForResponse(PurchaseOrder.findById(po._id));
        res.status(200).json({
            success: true,
            message: changed.length ? 'Purchase order updated' : 'Purchase order generated',
            data: populated,
        });
    } catch (error) {
        if (error.name === 'ValidationError' || error.name === 'CastError') {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error('Update PO error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Which status changes are meaningful now that POs are sent outside the CRM
const STATUS_TRANSITIONS = {
    draft: ['generated', 'cancelled'],
    generated: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
};

// @desc    Change a PO's status (generate / complete / cancel)
// @route   POST /api/purchase-orders/:id/status
// @access  Private (admin, purchase_manager)
exports.setPurchaseOrderStatus = async (req, res) => {
    try {
        if (denyUnlessCanManage(req, res)) return;

        const { status, note } = req.body;
        const allowed = ['generated', 'completed', 'cancelled'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });
        }

        const po = await PurchaseOrder.findById(req.params.id);
        if (!po || !po.isActive) return res.status(404).json({ success: false, message: 'Purchase order not found' });

        const current = LEGACY_SENT_STATUSES.includes(po.status) ? 'generated' : po.status;
        if (!(STATUS_TRANSITIONS[current] || []).includes(status)) {
            return res.status(400).json({
                success: false,
                message: `A "${current}" purchase order cannot be marked "${status}".`,
            });
        }

        po.status = status;
        po.logActivity(status, req.user, note);
        await po.save();

        const populated = await populateForResponse(PurchaseOrder.findById(po._id));
        res.status(200).json({ success: true, message: `Purchase order marked "${status}"`, data: populated });
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
