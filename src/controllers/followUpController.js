const FollowUp = require('../models/FollowUp');
const SalesEntry = require('../models/SalesEntry');
const Notification = require('../models/Notification');

// @desc    Add follow-up to a sales entry
// @route   POST /api/follow-ups
// @access  Private
exports.addFollowUp = async (req, res) => {
    try {
        const { salesEntryId, remark, nextFollowUpDate, status, addedBy, addedByName } = req.body;

        // Find the sales entry
        const salesEntry = await SalesEntry.findById(salesEntryId);
        
        if (!salesEntry) {
            return res.status(404).json({
                success: false,
                message: 'Sales entry not found'
            });
        }

        // Create follow-up
        const followUp = await FollowUp.create({
            salesEntry: salesEntryId,
            remark,
            nextFollowUpDate,
            status: status || 'Cold',
            addedBy: addedBy || req.user.id,
            addedByName: addedByName || req.user.name,
            followUpDate: new Date()
        });

        // Update sales entry
        salesEntry.followUpHistory.push(followUp._id);
        salesEntry.totalFollowUps += 1;
        salesEntry.lastFollowUpDate = new Date();
        salesEntry.remark = remark;
        salesEntry.queryStatus = status || salesEntry.queryStatus;
        
        if (nextFollowUpDate) {
            salesEntry.nextFollowUpDate = nextFollowUpDate;
        }

        await salesEntry.save();

        // Create notification for admin
        try {
            await Notification.create({
                type: 'followup',
                salesEntry: salesEntryId,
                companyName: salesEntry.companyName,
                salesPerson: addedBy || req.user.id,
                salesPersonName: addedByName || req.user.name,
                remark,
                nextFollowUpDate,
                followUpDate: new Date(),
                forRole: 'admin'
            });
        } catch (notifError) {
            console.error('Notification creation failed:', notifError);
        }

        // Populate the response
        const populatedFollowUp = await FollowUp.findById(followUp._id)
            .populate('addedBy', 'name username')
            .populate('salesEntry', 'companyName contactPerson');

        res.status(201).json({
            success: true,
            message: 'Follow-up added successfully',
            data: populatedFollowUp
        });
    } catch (error) {
        console.error('Add follow-up error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get all follow-ups for a sales entry
// @route   GET /api/follow-ups/sales/:salesEntryId
// @access  Private
exports.getFollowUpsBySalesEntry = async (req, res) => {
    try {
        const { salesEntryId } = req.params;

        const salesEntry = await SalesEntry.findById(salesEntryId);
        
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

        const followUps = await FollowUp.find({ salesEntry: salesEntryId })
            .populate('addedBy', 'name username')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: followUps.length,
            data: followUps
        });
    } catch (error) {
        console.error('Get follow-ups error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get all follow-ups by current user
// @route   GET /api/follow-ups/my
// @access  Private
exports.getMyFollowUps = async (req, res) => {
    try {
        const { page = 1, limit = 10, startDate, endDate } = req.query;

        const filter = { addedBy: req.user.id };

        if (startDate || endDate) {
            filter.followUpDate = {};
            if (startDate) filter.followUpDate.$gte = new Date(startDate);
            if (endDate) filter.followUpDate.$lte = new Date(endDate);
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;

        const [followUps, total] = await Promise.all([
            FollowUp.find(filter)
                .populate('salesEntry', 'companyName contactPerson contactNumber queryStatus')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum),
            FollowUp.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            data: followUps,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum),
                totalRecords: total
            }
        });
    } catch (error) {
        console.error('Get my follow-ups error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get single follow-up
// @route   GET /api/follow-ups/:id
// @access  Private
exports.getFollowUp = async (req, res) => {
    try {
        const followUp = await FollowUp.findById(req.params.id)
            .populate('addedBy', 'name username email')
            .populate('salesEntry', 'companyName contactPerson contactNumber queryStatus');

        if (!followUp) {
            return res.status(404).json({
                success: false,
                message: 'Follow-up not found'
            });
        }

        res.status(200).json({
            success: true,
            data: followUp
        });
    } catch (error) {
        console.error('Get follow-up error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Update follow-up
// @route   PUT /api/follow-ups/:id
// @access  Private
exports.updateFollowUp = async (req, res) => {
    try {
        let followUp = await FollowUp.findById(req.params.id);

        if (!followUp) {
            return res.status(404).json({
                success: false,
                message: 'Follow-up not found'
            });
        }

        // Check if user owns this follow-up or is admin
        if (req.user.role !== 'admin' && followUp.addedBy.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const { remark, nextFollowUpDate, status, contactMethod, outcome } = req.body;

        followUp = await FollowUp.findByIdAndUpdate(
            req.params.id,
            { remark, nextFollowUpDate, status, contactMethod, outcome },
            { new: true, runValidators: true }
        ).populate('addedBy', 'name username');

        // Update sales entry next follow-up date if changed
        if (nextFollowUpDate) {
            await SalesEntry.findByIdAndUpdate(followUp.salesEntry, {
                nextFollowUpDate,
                remark
            });
        }

        res.status(200).json({
            success: true,
            message: 'Follow-up updated successfully',
            data: followUp
        });
    } catch (error) {
        console.error('Update follow-up error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Delete follow-up
// @route   DELETE /api/follow-ups/:id
// @access  Private/Admin
exports.deleteFollowUp = async (req, res) => {
    try {
        const followUp = await FollowUp.findById(req.params.id);

        if (!followUp) {
            return res.status(404).json({
                success: false,
                message: 'Follow-up not found'
            });
        }

        // Remove from sales entry follow-up history
        await SalesEntry.findByIdAndUpdate(followUp.salesEntry, {
            $pull: { followUpHistory: followUp._id },
            $inc: { totalFollowUps: -1 }
        });

        await followUp.deleteOne();

        res.status(200).json({
            success: true,
            message: 'Follow-up deleted successfully'
        });
    } catch (error) {
        console.error('Delete follow-up error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};
