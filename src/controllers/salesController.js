const SalesEntry = require('../models/SalesEntry');
const FollowUp = require('../models/FollowUp');
const Notification = require('../models/Notification');
const User = require('../models/User');
const DismissedReminder = require('../models/DismissedReminder');
const { resolveDepartment, departmentQuery, canViewAllInDepartment } = require('../utils/department');

// @desc    Create new sales entry
// @route   POST /api/sales
// @access  Private
exports.createSalesEntry = async (req, res) => {
    try {
        // Set the sales person to current user if not provided
        const salesPersonId = req.body.salesPerson || req.user.id;

        const department = resolveDepartment(req);

        const salesEntryData = {
            ...req.body,
            salesPerson: salesPersonId,
            department,
            entryDate: req.body.entryDate || new Date()
        };

        const salesEntry = await SalesEntry.create(salesEntryData);

        // Populate the response
        const populatedEntry = await SalesEntry.findById(salesEntry._id)
            .populate('salesPerson', 'name username email');

        // Create notification for new entry (for admin)
        try {
            await Notification.create({
                type: 'new_entry',
                salesEntry: salesEntry._id,
                companyName: salesEntry.companyName,
                salesPerson: salesPersonId,
                salesPersonName: req.user.name,
                remark: salesEntry.remark,
                nextFollowUpDate: salesEntry.nextFollowUpDate,
                department,
                forRole: 'admin'
            });
        } catch (notifError) {
            console.error('Notification creation failed:', notifError);
        }

        res.status(201).json({
            success: true,
            message: 'Sales entry created successfully',
            data: populatedEntry
        });
    } catch (error) {
        console.error('Create sales entry error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get all sales entries with filtering & pagination
// @route   GET /api/sales
// @access  Private
exports.getSalesEntries = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 1000,
            queryStatus,
            salesPerson,
            branch,
            startDate,
            endDate,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Build filter object — scoped to the active department
        const filter = { isActive: true, ...departmentQuery(resolveDepartment(req)) };

        // Role-based filtering: restricted roles only see their own entries
        if (!canViewAllInDepartment(req.user.role)) {
            filter.salesPerson = req.user.id;
        } else if (salesPerson) {
            filter.salesPerson = salesPerson;
        }

        if (queryStatus) {
            filter.queryStatus = queryStatus;
        }

        if (branch) {
            filter.branch = branch;
        }

        // Date range filter
        if (startDate || endDate) {
            filter.entryDate = {};
            if (startDate) filter.entryDate.$gte = new Date(startDate);
            if (endDate) filter.entryDate.$lte = new Date(endDate);
        }

        // Text search
        if (search) {
            filter.$text = { $search: search };
        }

        // Calculate pagination
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Execute query
        const [salesEntries, total] = await Promise.all([
            SalesEntry.find(filter)
                .populate('salesPerson', 'name username email')
                .populate('branch', 'name code')
                .sort(sort)
                .skip(skip)
                .limit(limitNum),
            SalesEntry.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            data: salesEntries,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum),
                totalRecords: total,
                hasNextPage: pageNum * limitNum < total,
                hasPrevPage: pageNum > 1
            }
        });
    } catch (error) {
        console.error('Get sales entries error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get single sales entry
// @route   GET /api/sales/:id
// @access  Private
exports.getSalesEntry = async (req, res) => {
    try {
        const salesEntry = await SalesEntry.findById(req.params.id)
            .populate('salesPerson', 'name username email phoneNumber')
            .populate('branch', 'name code')
            .populate({
                path: 'followUpHistory',
                populate: {
                    path: 'addedBy',
                    select: 'name username'
                },
                options: { sort: { createdAt: -1 } }
            });

        if (!salesEntry) {
            return res.status(404).json({
                success: false,
                message: 'Sales entry not found'
            });
        }

        // Check access for restricted roles (only own entries)
        if (!canViewAllInDepartment(req.user.role) &&
            salesEntry.salesPerson._id.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        res.status(200).json({
            success: true,
            data: salesEntry
        });
    } catch (error) {
        console.error('Get sales entry error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Update sales entry
// @route   PUT /api/sales/:id
// @access  Private
exports.updateSalesEntry = async (req, res) => {
    try {
        let salesEntry = await SalesEntry.findById(req.params.id);

        if (!salesEntry) {
            return res.status(404).json({
                success: false,
                message: 'Sales entry not found'
            });
        }

        // Check access for restricted roles (only own entries)
        if (!canViewAllInDepartment(req.user.role) &&
            salesEntry.salesPerson.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Handle status change to converted
        if (req.body.queryStatus === 'converted' && salesEntry.queryStatus !== 'converted') {
            req.body.convertedDate = new Date();
        }

        salesEntry = await SalesEntry.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        )
        .populate('salesPerson', 'name username email')
        .populate('branch', 'name code');

        res.status(200).json({
            success: true,
            message: 'Sales entry updated successfully',
            data: salesEntry
        });
    } catch (error) {
        console.error('Update sales entry error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Delete sales entry (soft delete)
// @route   DELETE /api/sales/:id
// @access  Private/Admin
exports.deleteSalesEntry = async (req, res) => {
    try {
        const salesEntry = await SalesEntry.findById(req.params.id);

        if (!salesEntry) {
            return res.status(404).json({
                success: false,
                message: 'Sales entry not found'
            });
        }

        // Soft delete
        salesEntry.isActive = false;
        await salesEntry.save();

        res.status(200).json({
            success: true,
            message: 'Sales entry deleted successfully'
        });
    } catch (error) {
        console.error('Delete sales entry error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get today's follow-ups
// @route   GET /api/sales/follow-ups/today
// @access  Private
exports.getTodayFollowUps = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const filter = {
            nextFollowUpDate: {
                $gte: today,
                $lt: tomorrow
            },
            isActive: true,
            queryStatus: { $nin: ['converted', 'closed', 'not_interested'] },
            ...departmentQuery(resolveDepartment(req))
        };

        // Role-based filtering
        if (!canViewAllInDepartment(req.user.role)) {
            filter.salesPerson = req.user.id;
        }

        const followUps = await SalesEntry.find(filter)
            .populate('salesPerson', 'name username')
            .populate('branch', 'name code')
            .sort({ nextFollowUpDate: 1 });

        res.status(200).json({
            success: true,
            count: followUps.length,
            data: followUps
        });
    } catch (error) {
        console.error('Get today follow-ups error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Reassign leads to another salesperson. Supports either a specific
//          set of leads (leadIds) or, for backward compatibility, every lead
//          belonging to a source salesperson (fromSalesPerson).
// @route   POST /api/sales/reassign-leads
// @access  Private/Admin
exports.reassignLeads = async (req, res) => {
    try {
        const { fromSalesPerson, toSalesPerson, leadIds } = req.body;
        const hasLeadIds = Array.isArray(leadIds) && leadIds.length > 0;

        // Validate input
        if (!toSalesPerson) {
            return res.status(400).json({
                success: false,
                message: 'Destination salesperson is required'
            });
        }
        if (!hasLeadIds && !fromSalesPerson) {
            return res.status(400).json({
                success: false,
                message: 'Select at least one lead (or a source salesperson) to transfer'
            });
        }

        // Validate destination user
        const toUser = await User.findById(toSalesPerson);
        if (!toUser) {
            return res.status(404).json({
                success: false,
                message: 'Destination salesperson not found'
            });
        }
        if (!toUser.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Cannot assign leads to a deactivated salesperson'
            });
        }

        // Resolve the set of leads to transfer, scoped to the active department
        const deptFilter = departmentQuery(resolveDepartment(req));
        const findFilter = hasLeadIds
            ? { _id: { $in: leadIds }, ...deptFilter }
            : { salesPerson: fromSalesPerson, ...deptFilter };

        // Load entries with their current owner so per-lead history is accurate
        const entries = await SalesEntry.find(findFilter).populate('salesPerson', 'name');

        // Exclude leads already owned by the destination (nothing to do)
        const toTransfer = entries.filter(
            (e) => String(e.salesPerson?._id || e.salesPerson) !== String(toSalesPerson)
        );

        if (toTransfer.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No leads to transfer',
                data: { transferredCount: 0, to: { id: toUser._id, name: toUser.name } }
            });
        }

        const entryIds = toTransfer.map((e) => e._id);
        const now = new Date();

        // 1. Transfer ownership per-lead, recording each lead's previous owner
        const ops = toTransfer.map((e) => ({
            updateOne: {
                filter: { _id: e._id },
                update: {
                    $set: { salesPerson: toSalesPerson, branch: toUser.branch },
                    $push: {
                        previousSalesPersons: {
                            salesPerson: e.salesPerson?._id || e.salesPerson,
                            salesPersonName: e.salesPerson?.name || '',
                            branch: e.branch,
                            reassignedBy: req.user.id,
                            reassignedByName: req.user.name,
                            reassignedAt: now
                        }
                    }
                }
            }
        }));
        await SalesEntry.bulkWrite(ops);

        // 2. Re-point notifications tied to these leads to the new owner
        await Notification.updateMany(
            { salesEntry: { $in: entryIds } },
            { $set: { salesPerson: toSalesPerson, salesPersonName: toUser.name, forUser: toSalesPerson } }
        );

        // 3. Clear any dismissed reminders for these leads so pending follow-ups
        //    resurface for the new owner
        await DismissedReminder.deleteMany({ salesEntry: { $in: entryIds } });

        // Note: FollowUp.addedBy is intentionally preserved to retain the historical
        // record of who performed each follow-up. Follow-ups remain linked to the lead
        // and therefore automatically surface for the new owner.

        res.status(200).json({
            success: true,
            message: `Successfully transferred ${entryIds.length} lead(s) to ${toUser.name}`,
            data: {
                transferredCount: entryIds.length,
                to: { id: toUser._id, name: toUser.name }
            }
        });
    } catch (error) {
        console.error('Reassign leads error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get overdue follow-ups
// @route   GET /api/sales/follow-ups/overdue
// @access  Private
exports.getOverdueFollowUps = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const filter = {
            nextFollowUpDate: { $lt: today },
            isActive: true,
            queryStatus: { $nin: ['converted', 'closed', 'not_interested'] },
            ...departmentQuery(resolveDepartment(req))
        };

        // Role-based filtering
        if (!canViewAllInDepartment(req.user.role)) {
            filter.salesPerson = req.user.id;
        }

        const overdueEntries = await SalesEntry.find(filter)
            .populate('salesPerson', 'name username')
            .populate('branch', 'name code')
            .sort({ nextFollowUpDate: 1 });

        res.status(200).json({
            success: true,
            count: overdueEntries.length,
            data: overdueEntries
        });
    } catch (error) {
        console.error('Get overdue follow-ups error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};
