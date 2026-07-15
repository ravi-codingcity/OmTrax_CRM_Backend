const Business = require('../models/Business');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const { resolveDepartment, departmentQuery, canViewAllInDepartment } = require('../utils/department');

// A "business_sub" is a sandboxed temporary account that acts entirely on behalf
// of a single linked salesperson: everything it creates is owned by that
// salesperson, and it can only see that salesperson's entries. Resolve the
// linked owner (name/branch/department) once, or null for a normal user.
const resolveLinkedOwner = async (req) => {
    if (req.user.role !== 'business_sub' || !req.user.linkedSalesPerson) return null;
    const owner = await User.findById(req.user.linkedSalesPerson).select('name branch department');
    if (!owner) return null;
    return {
        id: owner._id,
        name: owner.name,
        branch: owner.branch,
        department: owner.department || 'relocation'
    };
};

const isBusinessSub = (req) => req.user.role === 'business_sub';

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

        // Sub-user: force ownership onto the linked salesperson (data reflects
        // under their account). Salesperson: only for themselves. Admin: may
        // pass an explicit salesPerson.
        const linkedOwner = await resolveLinkedOwner(req);
        if (isBusinessSub(req) && !linkedOwner) {
            return res.status(403).json({
                success: false,
                message: 'Sub-user is not linked to a salesperson'
            });
        }

        const salesPersonId = linkedOwner
            ? linkedOwner.id
            : (req.user.role === 'admin' && req.body.salesPerson
                ? req.body.salesPerson
                : req.user.id);

        const businessData = {
            client,
            jobNumber,
            estimateAmount,
            remarks,
            salesPerson: salesPersonId,
            salesPersonName: linkedOwner ? linkedOwner.name : (req.body.salesPersonName || req.user.name),
            branch: linkedOwner ? linkedOwner.branch : (req.body.branch || req.user.branch),
            department: linkedOwner ? linkedOwner.department : resolveDepartment(req),
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

        // Role-based filtering:
        //  - sub-user: locked to their linked salesperson's entries only
        //  - other restricted roles: only their own
        //  - full-access roles: all (optionally filtered by ?salesPerson)
        if (isBusinessSub(req)) {
            filter.salesPerson = req.user.linkedSalesPerson || null;
        } else if (!canViewAllInDepartment(req.user.role)) {
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

        // Access check for restricted roles (only own entries; sub-user only
        // its linked salesperson's entries)
        const allowedOwnerId = isBusinessSub(req)
            ? String(req.user.linkedSalesPerson || '')
            : req.user.id;
        if (!canViewAllInDepartment(req.user.role) &&
            business.salesPerson._id.toString() !== allowedOwnerId) {
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
        // Sub-users may only view and add — never edit
        if (isBusinessSub(req)) {
            return res.status(403).json({
                success: false,
                message: 'Sub-users can only view and add business entries'
            });
        }

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
        // Sub-users may only view and add — never delete
        if (isBusinessSub(req)) {
            return res.status(403).json({
                success: false,
                message: 'Sub-users can only view and add business entries'
            });
        }

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
