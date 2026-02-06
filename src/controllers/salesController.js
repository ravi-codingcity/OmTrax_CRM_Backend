const SalesEntry = require('../models/SalesEntry');
const FollowUp = require('../models/FollowUp');
const Notification = require('../models/Notification');

// @desc    Create new sales entry
// @route   POST /api/sales
// @access  Private
exports.createSalesEntry = async (req, res) => {
    try {
        // Set the sales person to current user if not provided
        const salesPersonId = req.body.salesPerson || req.user.id;

        const salesEntryData = {
            ...req.body,
            salesPerson: salesPersonId,
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
            limit = 10,
            queryStatus,
            salesPerson,
            branch,
            startDate,
            endDate,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Build filter object
        const filter = { isActive: true };

        // Role-based filtering
        if (req.user.role === 'salesperson') {
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

        // Check access for salesperson role
        if (req.user.role === 'salesperson' && 
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

        // Check access for salesperson role
        if (req.user.role === 'salesperson' && 
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
            queryStatus: { $nin: ['converted', 'closed', 'not_interested'] }
        };

        // Role-based filtering
        if (req.user.role === 'salesperson') {
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
            queryStatus: { $nin: ['converted', 'closed', 'not_interested'] }
        };

        // Role-based filtering
        if (req.user.role === 'salesperson') {
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
