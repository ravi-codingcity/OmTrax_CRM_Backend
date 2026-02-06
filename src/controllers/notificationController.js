const Notification = require('../models/Notification');
const SalesEntry = require('../models/SalesEntry');

// @desc    Get notifications for current user
// @route   GET /api/notifications
// @access  Private
exports.getNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20, isRead, type } = req.query;

        // Build filter - get notifications for user or for their role or for all
        const filter = {
            $or: [
                { forUser: req.user.id },
                { forRole: req.user.role },
                { forRole: 'all' }
            ]
        };

        if (isRead !== undefined) {
            filter.isRead = isRead === 'true';
        }

        if (type) {
            filter.type = type;
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(filter)
                .populate('salesEntry', 'companyName contactPerson queryStatus')
                .populate('salesPerson', 'name username')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum),
            Notification.countDocuments(filter),
            Notification.countDocuments({ ...filter, isRead: false })
        ]);

        res.status(200).json({
            success: true,
            data: notifications,
            unreadCount,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum),
                totalRecords: total
            }
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get unread notification count
// @route   GET /api/notifications/unread-count
// @access  Private
exports.getUnreadCount = async (req, res) => {
    try {
        const filter = {
            $or: [
                { forUser: req.user.id },
                { forRole: req.user.role },
                { forRole: 'all' }
            ],
            isRead: false
        };

        const count = await Notification.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: { unreadCount: count }
        });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get follow-up reminders (today and overdue)
// @route   GET /api/notifications/reminders
// @access  Private
exports.getReminders = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Base filter - exclude closed entries
        const baseFilter = {
            isActive: true,
            nextFollowUpDate: { $exists: true, $ne: null }
        };

        // Role-based filtering - salesperson sees only their own
        if (req.user.role === 'salesperson') {
            baseFilter.salesPerson = req.user.id;
        }

        // Get overdue follow-ups (before today)
        const overdueFilter = {
            ...baseFilter,
            nextFollowUpDate: { $lt: today }
        };

        // Get today's follow-ups
        const todayFilter = {
            ...baseFilter,
            nextFollowUpDate: { $gte: today, $lt: tomorrow }
        };

        const [overdueEntries, todayEntries] = await Promise.all([
            SalesEntry.find(overdueFilter)
                .populate('salesPerson', 'name username')
                .sort({ nextFollowUpDate: 1 })
                .select('companyName contactPerson contactNumber nextFollowUpDate queryStatus remark salesPerson branch'),
            SalesEntry.find(todayFilter)
                .populate('salesPerson', 'name username')
                .sort({ nextFollowUpDate: 1 })
                .select('companyName contactPerson contactNumber nextFollowUpDate queryStatus remark salesPerson branch')
        ]);

        // Format as reminders
        const reminders = [
            ...overdueEntries.map(entry => ({
                _id: entry._id,
                type: 'reminder',
                salesEntry: entry._id,
                companyName: entry.companyName,
                contactPerson: entry.contactPerson,
                contactNumber: entry.contactNumber,
                salesPerson: entry.salesPerson,
                salesPersonName: entry.salesPerson?.name || 'Unknown',
                remark: entry.remark,
                nextFollowUpDate: entry.nextFollowUpDate,
                followUpDate: entry.nextFollowUpDate,
                queryStatus: entry.queryStatus,
                branch: entry.branch,
                isOverdue: true,
                isRead: false
            })),
            ...todayEntries.map(entry => ({
                _id: entry._id,
                type: 'reminder',
                salesEntry: entry._id,
                companyName: entry.companyName,
                contactPerson: entry.contactPerson,
                contactNumber: entry.contactNumber,
                salesPerson: entry.salesPerson,
                salesPersonName: entry.salesPerson?.name || 'Unknown',
                remark: entry.remark,
                nextFollowUpDate: entry.nextFollowUpDate,
                followUpDate: entry.nextFollowUpDate,
                queryStatus: entry.queryStatus,
                branch: entry.branch,
                isOverdue: false,
                isRead: false
            }))
        ];

        res.status(200).json({
            success: true,
            data: reminders,
            summary: {
                total: reminders.length,
                overdue: overdueEntries.length,
                today: todayEntries.length
            }
        });
    } catch (error) {
        console.error('Get reminders error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Dismiss a reminder (mark as handled)
// @route   PUT /api/notifications/reminders/:id/dismiss
// @access  Private
exports.dismissReminder = async (req, res) => {
    try {
        // The id here is a SalesEntry ID, not a Notification ID
        // We just return success - the user clicked it, meaning they saw it
        // The reminder will reappear if follow-up date passes without action
        
        const salesEntry = await SalesEntry.findById(req.params.id);
        
        if (!salesEntry) {
            return res.status(404).json({
                success: false,
                message: 'Entry not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Reminder dismissed',
            data: { id: req.params.id }
        });
    } catch (error) {
        console.error('Dismiss reminder error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
exports.markAsRead = async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);

        if (!notification) {
            // Check if it's a SalesEntry ID (reminder click)
            const salesEntry = await SalesEntry.findById(req.params.id);
            if (salesEntry) {
                // It's a reminder, just return success
                return res.status(200).json({
                    success: true,
                    message: 'Reminder acknowledged',
                    data: { id: req.params.id }
                });
            }
            
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        notification.isRead = true;
        notification.readAt = new Date();
        await notification.save();

        res.status(200).json({
            success: true,
            message: 'Notification marked as read',
            data: notification
        });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
exports.markAllAsRead = async (req, res) => {
    try {
        const filter = {
            $or: [
                { forUser: req.user.id },
                { forRole: req.user.role },
                { forRole: 'all' }
            ],
            isRead: false
        };

        const result = await Notification.updateMany(filter, {
            isRead: true,
            readAt: new Date()
        });

        res.status(200).json({
            success: true,
            message: `${result.modifiedCount} notifications marked as read`
        });
    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Create notification (internal use or admin)
// @route   POST /api/notifications
// @access  Private/Admin
exports.createNotification = async (req, res) => {
    try {
        const notification = await Notification.create(req.body);

        res.status(201).json({
            success: true,
            message: 'Notification created successfully',
            data: notification
        });
    } catch (error) {
        console.error('Create notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
exports.deleteNotification = async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        await notification.deleteOne();

        res.status(200).json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Clear all read notifications
// @route   DELETE /api/notifications/clear-read
// @access  Private
exports.clearReadNotifications = async (req, res) => {
    try {
        const filter = {
            $or: [
                { forUser: req.user.id },
                { forRole: req.user.role },
                { forRole: 'all' }
            ],
            isRead: true
        };

        const result = await Notification.deleteMany(filter);

        res.status(200).json({
            success: true,
            message: `${result.deletedCount} notifications cleared`
        });
    } catch (error) {
        console.error('Clear notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Generate overdue notifications (for cron job)
// @route   POST /api/notifications/generate-overdue
// @access  Private/Admin
exports.generateOverdueNotifications = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Find overdue sales entries
        const overdueEntries = await SalesEntry.find({
            nextFollowUpDate: { $lt: today },
            isActive: true,
            queryStatus: { $nin: ['converted', 'closed', 'not_interested'] }
        }).populate('salesPerson', 'name');

        const notifications = [];

        for (const entry of overdueEntries) {
            // Check if notification already exists for today
            const existingNotification = await Notification.findOne({
                salesEntry: entry._id,
                type: 'reminder',
                isOverdue: true,
                createdAt: { $gte: today }
            });

            if (!existingNotification) {
                notifications.push({
                    type: 'reminder',
                    salesEntry: entry._id,
                    companyName: entry.companyName,
                    salesPerson: entry.salesPerson._id,
                    salesPersonName: entry.salesPerson.name,
                    remark: entry.remark,
                    nextFollowUpDate: entry.nextFollowUpDate,
                    isOverdue: true,
                    forUser: entry.salesPerson._id,
                    forRole: 'salesperson'
                });
            }
        }

        if (notifications.length > 0) {
            await Notification.insertMany(notifications);
        }

        res.status(200).json({
            success: true,
            message: `${notifications.length} overdue notifications generated`
        });
    } catch (error) {
        console.error('Generate overdue notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};
