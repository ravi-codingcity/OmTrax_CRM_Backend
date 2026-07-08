const Item = require('../models/Item');
const { MASTER_ITEMS, UNITS, CATEGORIES } = require('../constants/purchaseConstants');
const { resolveDepartment, departmentQuery } = require('../utils/department');

// @desc    Get items for autocomplete (DB items + predefined master items merged)
// @route   GET /api/purchase/items
// @access  Private (purchase / admin)
exports.getItems = async (req, res) => {
    try {
        const { search } = req.query;
        const department = resolveDepartment(req);

        const dbItems = await Item.find({ isActive: true, ...departmentQuery(department) })
            .select('name category unit')
            .sort({ name: 1 });

        // Merge DB items with master items, deduped by lower-cased name
        const seen = new Set();
        const merged = [];
        dbItems.forEach((i) => {
            const key = i.name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                merged.push({ name: i.name, category: i.category || '', unit: i.unit || '' });
            }
        });
        MASTER_ITEMS.forEach((i) => {
            const key = i.name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                merged.push({ ...i });
            }
        });

        let result = merged.sort((a, b) => a.name.localeCompare(b.name));
        if (search) {
            const term = search.toLowerCase();
            result = result.filter((i) => i.name.toLowerCase().includes(term));
        }

        res.status(200).json({ success: true, data: result, units: UNITS, categories: CATEGORIES });
    } catch (error) {
        console.error('Get items error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Create a new item (if it does not already exist)
// @route   POST /api/purchase/items
// @access  Private (purchase / admin)
exports.createItem = async (req, res) => {
    try {
        const { name, category, unit } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Item name is required' });
        }
        const department = resolveDepartment(req);

        // Case-insensitive existence check within the department
        const existing = await Item.findOne({
            ...departmentQuery(department),
            name: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
        });
        if (existing) {
            return res.status(200).json({ success: true, message: 'Item already exists', data: existing });
        }

        const item = await Item.create({
            name: name.trim(),
            category,
            unit,
            department,
            createdBy: req.user.id,
            createdByName: req.user.name
        });

        res.status(201).json({ success: true, message: 'Item created successfully', data: item });
    } catch (error) {
        console.error('Create item error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
