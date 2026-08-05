const PurchaseEntry = require('../models/PurchaseEntry');
const Item = require('../models/Item');
const Supplier = require('../models/Supplier');
const StorageLocation = require('../models/StorageLocation');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const { resolveDepartment, departmentQuery } = require('../utils/department');
const {
    validateDispatch, validateReturn, canModifyEntry, buildInventorySummary,
    canReceive, canManageStock, isLocationManager, LOCATION_ROLES
} = require('../services/purchaseService');

// 403 helper — only the record's creator (or a CRM Admin) may edit procurement details.
const denyIfNotOwner = (entry, req, res) => {
    if (canModifyEntry(entry, req.user)) return false;
    res.status(403).json({
        success: false,
        message: 'You can only modify purchase records that you created'
    });
    return true;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A short label for a material used in notifications: "Item @ Location"
const materialLabel = (entry) =>
    `${entry.itemName || 'Material'}${entry.storageLocation ? ` @ ${entry.storageLocation}` : ''}`;

// Append one line to the material's audit trail.
const logActivity = (entry, action, req, extra = {}) => {
    entry.activity = entry.activity || [];
    entry.activity.push({
        action,
        at: new Date(),
        byUser: req.user.id,
        byName: req.user.name,
        byRole: req.user.role,
        ...extra
    });
};

// Fire-and-forget notification helper (never breaks the main request).
const notify = async (payload) => {
    try {
        await Notification.create({ department: 'purchase', ...payload });
    } catch (err) {
        console.error('Purchase notification failed:', err.message);
    }
};

// The location manager(s) responsible for a storage location = active
// warehouse/branch managers in the purchase department whose branch matches.
const findLocationManagers = async (locationName) => {
    if (!locationName || !locationName.trim()) return [];
    return User.find({
        department: 'purchase',
        isActive: true,
        role: { $in: LOCATION_ROLES },
        branch: new RegExp(`^${escapeRegex(locationName.trim())}$`, 'i')
    }).select('_id name role');
};

// Location-based visibility: warehouse/branch managers see only entries for
// their own location; purchase managers and admins see everything in the dept.
const locationScopeFilter = (req) => {
    if (isLocationManager(req.user)) {
        const branch = (req.user.branch || '__none__').trim();
        return { storageLocation: new RegExp(`^${escapeRegex(branch)}$`, 'i') };
    }
    return {};
};

// Ensure the item exists in the master catalogue (so it shows in autocomplete).
const ensureItem = async (name, unit, department, user) => {
    if (!name) return;
    try {
        const existing = await Item.findOne({
            ...departmentQuery(department),
            name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i')
        });
        if (!existing) {
            await Item.create({ name: name.trim(), unit, department, createdBy: user.id, createdByName: user.name });
        }
    } catch (err) {
        console.error('ensureItem failed:', err.message);
    }
};

// Ensure the storage location exists in the master (so it shows in autocomplete).
const ensureStorageLocation = async (name, department, user) => {
    if (!name || !name.trim()) return;
    try {
        const existing = await StorageLocation.findOne({
            ...departmentQuery(department),
            name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i')
        });
        if (!existing) {
            await StorageLocation.create({
                name: name.trim(),
                type: /warehouse/i.test(name) ? 'Warehouse' : 'Branch',
                department,
                createdBy: user.id,
                createdByName: user.name
            });
        }
    } catch (err) {
        console.error('ensureStorageLocation failed:', err.message);
    }
};

// Ensure the supplier exists in the supplier master (so it shows in autocomplete).
const ensureSupplier = async (name, department, user) => {
    if (!name || !name.trim()) return;
    try {
        const existing = await Supplier.findOne({
            ...departmentQuery(department),
            name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i')
        });
        if (!existing) {
            await Supplier.create({ name: name.trim(), department, createdBy: user.id, createdByName: user.name });
        }
    } catch (err) {
        console.error('ensureSupplier failed:', err.message);
    }
};

// @desc    Create a purchase entry
// @route   POST /api/purchase/entries
// @access  Private (purchase / admin)
exports.createEntry = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const department = resolveDepartment(req);
        const {
            itemName, storageLocation, supplier, purchaseDate, quantityPurchased,
            unit, unitPrice, totalAmount, invoiceNumber, remarks
        } = req.body;

        const qty = Number(quantityPurchased) || 0;
        const price = Number(unitPrice) || 0;
        const amount = totalAmount !== undefined && totalAmount !== '' ? Number(totalAmount) : qty * price;

        const entry = new PurchaseEntry({
            itemName,
            storageLocation,
            supplier,
            purchaseDate: purchaseDate || new Date(),
            quantityPurchased: qty,
            unit,
            unitPrice: price,
            totalAmount: amount,
            invoiceNumber,
            remarks,
            department,
            receiptStatus: 'pending',
            createdBy: req.user.id,
            createdByName: req.user.name,
            createdByUsername: req.user.username,
            createdByBranch: req.user.branch
        });
        logActivity(entry, 'purchased', req, { quantity: qty, note: `Purchased ${qty} ${unit || ''}`.trim() });
        await entry.save();

        // Keep the item, supplier & storage-location masters up to date for autocomplete
        await ensureItem(itemName, unit, department, req.user);
        await ensureSupplier(supplier, department, req.user);
        await ensureStorageLocation(storageLocation, department, req.user);

        // Notify the location manager(s) responsible for this storage location
        const managers = await findLocationManagers(storageLocation);
        await Promise.all(managers.map((m) => notify({
            type: 'purchase_receipt_request',
            purchaseEntry: entry._id,
            companyName: materialLabel(entry),
            remark: `Qty ${qty} ${unit || ''}`.trim(),
            salesPerson: req.user.id,
            salesPersonName: req.user.name,
            forUser: m._id,
            forRole: m.role
        })));

        res.status(201).json({ success: true, message: 'Purchase entry created successfully', data: entry });
    } catch (error) {
        console.error('Create purchase entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    List purchase entries (department-scoped, with search & pagination)
// @route   GET /api/purchase/entries
// @access  Private (purchase / admin)
exports.getEntries = async (req, res) => {
    try {
        const { search, storageLocation, page = 1, limit = 1000 } = req.query;
        // Location managers are confined to their own location; PM/admin see all.
        const filter = { isActive: true, ...departmentQuery(resolveDepartment(req)), ...locationScopeFilter(req) };
        if (storageLocation && !isLocationManager(req.user)) filter.storageLocation = storageLocation;
        if (search) {
            filter.$or = [
                { itemName: { $regex: search, $options: 'i' } },
                { supplier: { $regex: search, $options: 'i' } },
                { invoiceNumber: { $regex: search, $options: 'i' } },
                { storageLocation: { $regex: search, $options: 'i' } }
            ];
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);

        const [entries, total] = await Promise.all([
            PurchaseEntry.find(filter)
                .populate('createdBy', 'name username branch')
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            PurchaseEntry.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            data: entries,
            pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum), totalRecords: total }
        });
    } catch (error) {
        console.error('Get purchase entries error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Get one purchase entry (with full dispatch/return history)
// @route   GET /api/purchase/entries/:id
// @access  Private (purchase / admin)
exports.getEntry = async (req, res) => {
    try {
        const entry = await PurchaseEntry.findById(req.params.id)
            .populate('createdBy', 'name username branch')
            .populate('receivedBy', 'name username');
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });

        // Location managers may only view their own location's records
        if (isLocationManager(req.user) &&
            (req.user.branch || '').trim().toLowerCase() !== (entry.storageLocation || '').trim().toLowerCase()) {
            return res.status(403).json({ success: false, message: 'Access denied for this location' });
        }

        res.status(200).json({ success: true, data: entry });
    } catch (error) {
        console.error('Get purchase entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Update procurement details of a purchase entry
// @route   PUT /api/purchase/entries/:id
// @access  Private (purchase / admin)
exports.updateEntry = async (req, res) => {
    try {
        const entry = await PurchaseEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });
        if (denyIfNotOwner(entry, req, res)) return;

        const editable = ['itemName', 'storageLocation', 'supplier', 'purchaseDate', 'quantityPurchased', 'unit', 'unitPrice', 'totalAmount', 'invoiceNumber', 'remarks'];
        editable.forEach((f) => {
            if (req.body[f] !== undefined) entry[f] = req.body[f];
        });
        // Recompute total amount when qty or price provided without an explicit total
        if ((req.body.quantityPurchased !== undefined || req.body.unitPrice !== undefined) && req.body.totalAmount === undefined) {
            entry.totalAmount = (Number(entry.quantityPurchased) || 0) * (Number(entry.unitPrice) || 0);
        }
        await entry.save(); // pre-save hook recomputes availableStock

        res.status(200).json({ success: true, message: 'Purchase entry updated successfully', data: entry });
    } catch (error) {
        console.error('Update purchase entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Soft-delete a purchase entry (Admin only)
// @route   DELETE /api/purchase/entries/:id
// @access  Private/Admin
exports.deleteEntry = async (req, res) => {
    try {
        const entry = await PurchaseEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });
        entry.isActive = false;
        await entry.save();
        res.status(200).json({ success: true, message: 'Purchase entry deleted successfully' });
    } catch (error) {
        console.error('Delete purchase entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// 403 helper for stock actions — the location manager (or admin) who owns the
// storage location may act, and only after the material has been received.
const denyIfCannotManageStock = (entry, req, res) => {
    if (canManageStock(entry, req.user)) return false;
    const msg = entry.receiptStatus !== 'received'
        ? 'Material must be marked Received first'
        : 'Only the location manager for this storage location can do this';
    res.status(403).json({ success: false, message: msg });
    return true;
};

// Notify the purchase manager who created the material about a lifecycle event.
const notifyCreator = (entry, type, req, remark) => {
    if (!entry.createdBy) return Promise.resolve();
    return notify({
        type,
        purchaseEntry: entry._id,
        companyName: materialLabel(entry),
        remark,
        salesPerson: req.user.id,
        salesPersonName: req.user.name,
        forUser: entry.createdBy._id || entry.createdBy
    });
};

// @desc    Mark a pending material as Received / Not Received (location manager)
// @route   POST /api/purchase/entries/:id/receive
// @access  Private (location manager for the storage location, or admin)
exports.receiveEntry = async (req, res) => {
    try {
        const entry = await PurchaseEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });

        if (!canReceive(entry, req.user)) {
            return res.status(403).json({ success: false, message: 'Only the location manager for this storage location can confirm receipt' });
        }
        if (entry.receiptStatus !== 'pending') {
            return res.status(400).json({ success: false, message: `This material has already been marked "${entry.receiptStatus.replace('_', ' ')}"` });
        }

        const status = req.body.status === 'not_received' ? 'not_received' : 'received';
        const note = (req.body.note || '').trim();

        entry.receiptStatus = status;
        entry.receivedBy = req.user.id;
        entry.receivedByName = req.user.name;
        entry.receivedAt = new Date();
        entry.receiptNote = note;
        logActivity(entry, status, req, { note: note || (status === 'received' ? 'Marked received' : 'Marked not received') });
        await entry.save();

        await notifyCreator(
            entry,
            status === 'received' ? 'purchase_received' : 'purchase_not_received',
            req,
            `${status === 'received' ? 'Received' : 'Not received'} by ${req.user.name}${note ? ` — ${note}` : ''}`
        );

        const populated = await PurchaseEntry.findById(entry._id)
            .populate('createdBy', 'name username branch')
            .populate('receivedBy', 'name username');
        res.status(200).json({ success: true, message: `Material marked ${status.replace('_', ' ')}`, data: populated });
    } catch (error) {
        console.error('Receive entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Record a dispatch against a purchase entry
// @route   POST /api/purchase/entries/:id/dispatch
// @access  Private (location manager for the storage location, or admin)
exports.addDispatch = async (req, res) => {
    try {
        const entry = await PurchaseEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });

        if (denyIfCannotManageStock(entry, req, res)) return;

        const check = validateDispatch(entry, req.body);
        if (!check.ok) return res.status(400).json({ success: false, message: check.message });

        const location = (req.body.location || '').trim();
        if (!location) return res.status(400).json({ success: false, message: 'Location is required' });

        const qty = Number(req.body.quantity);
        const jobNumber = String(req.body.jobNumber).trim();
        entry.dispatches.push({
            dispatchDate: req.body.dispatchDate || new Date(),
            quantity: qty,
            jobNumber,
            location,
            remark: req.body.remark,
            createdBy: req.user.id,
            createdByName: req.user.name
        });
        logActivity(entry, 'dispatch', req, { quantity: qty, jobNumber, note: `To ${location}${req.body.remark ? ` — ${req.body.remark}` : ''}` });
        await entry.save();

        await notifyCreator(entry, 'purchase_dispatch', req, `Dispatched ${qty} to ${location} (Job #${jobNumber}) by ${req.user.name}`);

        res.status(200).json({ success: true, message: 'Dispatch recorded successfully', data: entry });
    } catch (error) {
        console.error('Add dispatch error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Record a return against a purchase entry
// @route   POST /api/purchase/entries/:id/return
// @access  Private (location manager for the storage location, or admin)
exports.addReturn = async (req, res) => {
    try {
        const entry = await PurchaseEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });

        if (denyIfCannotManageStock(entry, req, res)) return;

        const check = validateReturn(entry, req.body.quantity);
        if (!check.ok) return res.status(400).json({ success: false, message: check.message });

        const location = (req.body.location || '').trim();
        if (!location) return res.status(400).json({ success: false, message: 'Location is required' });

        const qty = Number(req.body.quantity);
        entry.returns.push({
            returnDate: req.body.returnDate || new Date(),
            quantity: qty,
            location,
            createdBy: req.user.id,
            createdByName: req.user.name
        });
        logActivity(entry, 'return', req, { quantity: qty, note: `Returned ${qty} to ${location}` });
        await entry.save();

        await notifyCreator(entry, 'purchase_return', req, `Returned ${qty} to ${location} by ${req.user.name}`);

        res.status(200).json({ success: true, message: 'Return recorded successfully', data: entry });
    } catch (error) {
        console.error('Add return error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Per-item inventory summary
// @route   GET /api/purchase/inventory
// @access  Private (purchase / admin)
exports.getInventory = async (req, res) => {
    try {
        // Only received materials count as inventory, scoped to the caller's location.
        const entries = await PurchaseEntry.find({
            isActive: true,
            receiptStatus: 'received',
            ...departmentQuery(resolveDepartment(req)),
            ...locationScopeFilter(req)
        }).select('itemName storageLocation unit quantityPurchased totalDispatched totalReturned availableStock');
        res.status(200).json({ success: true, data: buildInventorySummary(entries) });
    } catch (error) {
        console.error('Get inventory error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Purchase dashboard statistics
// @route   GET /api/purchase/stats
// @access  Private (purchase / admin)
exports.getStats = async (req, res) => {
    try {
        const scoped = { isActive: true, ...departmentQuery(resolveDepartment(req)), ...locationScopeFilter(req) };
        // Stock figures come from received materials only.
        const receivedEntries = await PurchaseEntry.find({ ...scoped, receiptStatus: 'received' })
            .select('itemName storageLocation unit quantityPurchased totalDispatched totalReturned availableStock totalAmount');
        const pendingReceipts = await PurchaseEntry.countDocuments({ ...scoped, receiptStatus: 'pending' });

        const inventory = buildInventorySummary(receivedEntries);
        const totals = receivedEntries.reduce((acc, e) => {
            acc.purchaseValue += e.totalAmount || 0;
            acc.purchasedQty += e.quantityPurchased || 0;
            acc.dispatchedQty += e.totalDispatched || 0;
            acc.returnedQty += e.totalReturned || 0;
            acc.availableStock += e.availableStock || 0;
            return acc;
        }, { purchaseValue: 0, purchasedQty: 0, dispatchedQty: 0, returnedQty: 0, availableStock: 0 });

        const lowStock = inventory.filter((i) => i.availableStock > 0 && i.availableStock <= 5).length;
        const outOfStock = inventory.filter((i) => i.availableStock <= 0).length;

        res.status(200).json({
            success: true,
            data: {
                totalEntries: receivedEntries.length,
                totalItems: inventory.length,
                pendingReceipts,
                ...totals,
                lowStock,
                outOfStock,
                topItems: inventory.slice(0, 6)
            }
        });
    } catch (error) {
        console.error('Get purchase stats error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
