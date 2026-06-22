const Business = require('../models/Business');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const { resolveDepartment, departmentQuery, canViewAllInDepartment } = require('../utils/department');

// Helper: create a notification visible to both the salesperson (forUser)
// and admins (forRole). One document satisfies the getNotifications $or filter
// for both audiences.
const createBusinessNotification = async ({ type, business, actor }) => {
    try {
        await Notification.create({
            type,
            companyName: business.client,
            salesPerson: business.salesPerson,
            salesPersonName: business.salesPersonName,
            remark: `Job #${business.jobNumber} • ₹${Number(business.estimateAmount || 0).toLocaleString('en-IN')}`,
            department: business.department || 'relocation',
            forUser: business.salesPerson,
            forRole: 'admin'
        });
    } catch (notifError) {
        console.error('Business notification creation failed:', notifError);
    }
};

// @desc    Create new business entry
// @route   POST /api/business
// @access  Private
exports.createBusiness = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { client, jobNumber, estimateAmount, remarks } = req.body;

        // Salesperson can only create for themselves; admin may pass an explicit salesPerson
        const salesPersonId =
            req.user.role === 'admin' && req.body.salesPerson
                ? req.body.salesPerson
                : req.user.id;

        const businessData = {
            client,
            jobNumber,
            estimateAmount,
            remarks,
            salesPerson: salesPersonId,
            salesPersonName: req.body.salesPersonName || req.user.name,
            branch: req.body.branch || req.user.branch,
            department: resolveDepartment(req),
            entryDate: req.body.entryDate || new Date()
        };

        const business = await Business.create(businessData);

        const populated = await Business.findById(business._id)
            .populate('salesPerson', 'name username email');

        await createBusinessNotification({
            type: 'business_new',
            business,
            actor: req.user
        });

        res.status(201).json({
            success: true,
            message: 'Business entry created successfully',
            data: populated
        });
    } catch (error) {
        // Duplicate job number
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Job number already exists. It must be unique.'
            });
        }
        console.error('Create business error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get business entries (role-based)
// @route   GET /api/business
// @access  Private
exports.getBusinessEntries = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 1000,
            salesPerson,
            client,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const filter = { isActive: true, ...departmentQuery(resolveDepartment(req)) };

        // Role-based filtering - restricted roles see only their own
        if (!canViewAllInDepartment(req.user.role)) {
            filter.salesPerson = req.user.id;
        } else if (salesPerson) {
            filter.salesPerson = salesPerson;
        }

        if (client) {
            filter.client = client;
        }

        if (search) {
            filter.$or = [
                { client: { $regex: search, $options: 'i' } },
                { jobNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;

        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        const [businessEntries, total] = await Promise.all([
            Business.find(filter)
                .populate('salesPerson', 'name username email')
                .sort(sort)
                .skip(skip)
                .limit(limitNum),
            Business.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            data: businessEntries,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum),
                totalRecords: total
            }
        });
    } catch (error) {
        console.error('Get business entries error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get single business entry
// @route   GET /api/business/:id
// @access  Private
exports.getBusiness = async (req, res) => {
    try {
        const business = await Business.findById(req.params.id)
            .populate('salesPerson', 'name username email');

        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'Business entry not found'
            });
        }

        // Access check for restricted roles (only own entries)
        if (!canViewAllInDepartment(req.user.role) &&
            business.salesPerson._id.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        res.status(200).json({
            success: true,
            data: business
        });
    } catch (error) {
        console.error('Get business error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Update business entry (job number is immutable)
// @route   PUT /api/business/:id
// @access  Private
exports.updateBusiness = async (req, res) => {
    try {
        const business = await Business.findById(req.params.id);

        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'Business entry not found'
            });
        }

        // Restricted roles may only edit their own entries
        if (!canViewAllInDepartment(req.user.role) &&
            business.salesPerson.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Job number is immutable - never allow changes regardless of role
        const { client, estimateAmount, remarks } = req.body;
        const updates = {};
        if (client !== undefined) updates.client = client;
        if (estimateAmount !== undefined) updates.estimateAmount = estimateAmount;
        if (remarks !== undefined) updates.remarks = remarks;

        const updated = await Business.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true }
        ).populate('salesPerson', 'name username email');

        await createBusinessNotification({
            type: 'business_update',
            business: updated,
            actor: req.user
        });

        res.status(200).json({
            success: true,
            message: 'Business entry updated successfully',
            data: updated
        });
    } catch (error) {
        console.error('Update business error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Delete business entry (soft delete) - Admin only
// @route   DELETE /api/business/:id
// @access  Private/Admin
exports.deleteBusiness = async (req, res) => {
    try {
        const business = await Business.findById(req.params.id);

        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'Business entry not found'
            });
        }

        business.isActive = false;
        await business.save();

        res.status(200).json({
            success: true,
            message: 'Business entry deleted successfully'
        });
    } catch (error) {
        console.error('Delete business error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};
