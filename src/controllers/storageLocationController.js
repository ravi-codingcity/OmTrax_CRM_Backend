const StorageLocation = require('../models/StorageLocation');
const { STORAGE_LOCATIONS } = require('../constants/purchaseConstants');
const { resolveDepartment, departmentQuery } = require('../utils/department');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Get storage locations (predefined master + user-added), for autocomplete
// @route   GET /api/purchase/locations
// @access  Private (purchase / admin)
exports.getLocations = async (req, res) => {
    try {
        const { search } = req.query;
        const department = resolveDepartment(req);

        const dbLocations = await StorageLocation.find({ isActive: true, ...departmentQuery(department) })
            .select('name type')
            .sort({ name: 1 });

        // Merge DB locations with the predefined list, deduped by lower-cased name
        const seen = new Set();
        const merged = [];
        dbLocations.forEach((l) => {
            const key = l.name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                merged.push({ name: l.name, type: l.type || 'Branch' });
            }
        });
        STORAGE_LOCATIONS.forEach((name) => {
            const key = name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                merged.push({ name, type: /warehouse/i.test(name) ? 'Warehouse' : 'Branch' });
            }
        });

        let result = merged.sort((a, b) => a.name.localeCompare(b.name));
        if (search) {
            const term = search.toLowerCase();
            result = result.filter((l) => l.name.toLowerCase().includes(term));
        }

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Get storage locations error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Create a storage location if it does not already exist
// @route   POST /api/purchase/locations
// @access  Private (purchase / admin)
exports.createLocation = async (req, res) => {
    try {
        const { name, type } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Location name is required' });
        }
        const department = resolveDepartment(req);

        const existing = await StorageLocation.findOne({
            ...departmentQuery(department),
            name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i')
        });
        if (existing) {
            return res.status(200).json({ success: true, message: 'Location already exists', data: existing });
        }

        const location = await StorageLocation.create({
            name: name.trim(),
            type: type || (/warehouse/i.test(name) ? 'Warehouse' : 'Branch'),
            department,
            createdBy: req.user.id,
            createdByName: req.user.name
        });
        res.status(201).json({ success: true, message: 'Location created successfully', data: location });
    } catch (error) {
        console.error('Create storage location error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
