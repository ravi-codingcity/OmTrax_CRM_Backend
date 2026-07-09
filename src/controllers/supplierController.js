const Supplier = require('../models/Supplier');
const { resolveDepartment, departmentQuery } = require('../utils/department');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Get suppliers for autocomplete (searchable dropdown)
// @route   GET /api/purchase/suppliers
// @access  Private (purchase / admin)
exports.getSuppliers = async (req, res) => {
    try {
        const { search } = req.query;
        const filter = { isActive: true, ...departmentQuery(resolveDepartment(req)) };
        if (search) filter.name = { $regex: search, $options: 'i' };

        const suppliers = await Supplier.find(filter).select('name contact').sort({ name: 1 });
        res.status(200).json({ success: true, data: suppliers });
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Create a supplier if it does not already exist
// @route   POST /api/purchase/suppliers
// @access  Private (purchase / admin)
exports.createSupplier = async (req, res) => {
    try {
        const { name, contact } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Supplier name is required' });
        }
        const department = resolveDepartment(req);

        const existing = await Supplier.findOne({
            ...departmentQuery(department),
            name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i')
        });
        if (existing) {
            return res.status(200).json({ success: true, message: 'Supplier already exists', data: existing });
        }

        const supplier = await Supplier.create({
            name: name.trim(),
            contact,
            department,
            createdBy: req.user.id,
            createdByName: req.user.name
        });
        res.status(201).json({ success: true, message: 'Supplier created successfully', data: supplier });
    } catch (error) {
        console.error('Create supplier error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
