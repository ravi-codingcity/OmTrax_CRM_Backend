const PurchaseEntry = require('../models/PurchaseEntry');
const Item = require('../models/Item');
const Supplier = require('../models/Supplier');
const StorageLocation = require('../models/StorageLocation');
const { validationResult } = require('express-validator');
const { resolveDepartment, departmentQuery } = require('../utils/department');
const { validateDispatch, validateReturn, canModifyEntry, buildInventorySummary } = require('../services/purchaseService');

// 403 helper — only the record's creator (or a CRM Admin) may modify it.
const denyIfNotOwner = (entry, req, res) => {
    if (canModifyEntry(entry, req.user)) return false;
    res.status(403).json({
        success: false,
        message: 'You can only modify purchase records that you created'
    });
    return true;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

        const entry = await PurchaseEntry.create({
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
            createdBy: req.user.id,
            createdByName: req.user.name,
            createdByUsername: req.user.username
        });

        // Keep the item, supplier & storage-location masters up to date for autocomplete
        await ensureItem(itemName, unit, department, req.user);
        await ensureSupplier(supplier, department, req.user);
        await ensureStorageLocation(storageLocation, department, req.user);

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
        const filter = { isActive: true, ...departmentQuery(resolveDepartment(req)) };
        if (storageLocation) filter.storageLocation = storageLocation;
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
                .populate('createdBy', 'name username')
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
        const entry = await PurchaseEntry.findById(req.params.id).populate('createdBy', 'name username');
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });
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

// @desc    Record a dispatch against a purchase entry
// @route   POST /api/purchase/entries/:id/dispatch
// @access  Private (purchase / admin)
exports.addDispatch = async (req, res) => {
    try {
        const entry = await PurchaseEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });

        if (denyIfNotOwner(entry, req, res)) return;

        const check = validateDispatch(entry, req.body);
        if (!check.ok) return res.status(400).json({ success: false, message: check.message });

        entry.dispatches.push({
            dispatchDate: req.body.dispatchDate || new Date(),
            quantity: Number(req.body.quantity),
            jobNumber: String(req.body.jobNumber).trim(),
            remark: req.body.remark,
            createdBy: req.user.id,
            createdByName: req.user.name
        });
        await entry.save();

        res.status(200).json({ success: true, message: 'Dispatch recorded successfully', data: entry });
    } catch (error) {
        console.error('Add dispatch error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Record a return against a purchase entry
// @route   POST /api/purchase/entries/:id/return
// @access  Private (purchase / admin)
exports.addReturn = async (req, res) => {
    try {
        const entry = await PurchaseEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Purchase entry not found' });

        if (denyIfNotOwner(entry, req, res)) return;

        const check = validateReturn(entry, req.body.quantity);
        if (!check.ok) return res.status(400).json({ success: false, message: check.message });

        entry.returns.push({
            returnDate: req.body.returnDate || new Date(),
            quantity: Number(req.body.quantity),
            createdBy: req.user.id,
            createdByName: req.user.name
        });
        await entry.save();

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
        const entries = await PurchaseEntry.find({ isActive: true, ...departmentQuery(resolveDepartment(req)) })
            .select('itemName storageLocation unit quantityPurchased totalDispatched totalReturned availableStock');
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
        const entries = await PurchaseEntry.find({ isActive: true, ...departmentQuery(resolveDepartment(req)) })
            .select('itemName storageLocation unit quantityPurchased totalDispatched totalReturned availableStock totalAmount');

        const inventory = buildInventorySummary(entries);
        const totals = entries.reduce((acc, e) => {
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
                totalEntries: entries.length,
                totalItems: inventory.length,
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
