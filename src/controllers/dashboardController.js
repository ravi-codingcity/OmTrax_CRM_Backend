const SalesEntry = require('../models/SalesEntry');
const FollowUp = require('../models/FollowUp');
const User = require('../models/User');
const Notification = require('../models/Notification');

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private
exports.getDashboardStats = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const startOfYear = new Date(today.getFullYear(), 0, 1);

        // Build base filter based on user role
        const baseFilter = { isActive: true };
        if (req.user.role === 'salesperson') {
            baseFilter.salesPerson = req.user.id;
        }

        // Execute all queries in parallel for better performance
        const [
            totalEntries,
            hotEntries,
            warmEntries,
            coldEntries,
            closedEntries,
            activeEntries,
            newEntries,
            todayFollowUps,
            overdueFollowUps,
            monthlyEntries,
            totalFollowUps,
            todayEntries,
            byBranchData,
            byRequirementData,
            bySalesPersonData,
            statusDistribution
        ] = await Promise.all([
            // Total entries
            SalesEntry.countDocuments(baseFilter),
            
            // Status wise counts (case-insensitive)
            SalesEntry.countDocuments({ ...baseFilter, queryStatus: { $regex: /^hot$/i } }),
            SalesEntry.countDocuments({ ...baseFilter, queryStatus: { $regex: /^warm$/i } }),
            SalesEntry.countDocuments({ ...baseFilter, queryStatus: { $regex: /^cold$/i } }),
            SalesEntry.countDocuments({ ...baseFilter, queryStatus: { $regex: /^closed$/i } }),
            SalesEntry.countDocuments({ ...baseFilter, queryStatus: { $regex: /^active$/i } }),
            SalesEntry.countDocuments({ ...baseFilter, queryStatus: { $regex: /^new$/i } }),
            
            // Today's follow-ups
            SalesEntry.countDocuments({
                ...baseFilter,
                nextFollowUpDate: { $gte: today, $lt: tomorrow }
            }),
            
            // Overdue follow-ups
            SalesEntry.countDocuments({
                ...baseFilter,
                nextFollowUpDate: { $lt: today, $exists: true, $ne: null }
            }),
            
            // Monthly entries
            SalesEntry.countDocuments({
                ...baseFilter,
                entryDate: { $gte: startOfMonth }
            }),
            
            // Total follow-ups made
            req.user.role === 'salesperson'
                ? FollowUp.countDocuments({ addedBy: req.user.id })
                : FollowUp.countDocuments({}),
            
            // Today's entries
            SalesEntry.countDocuments({
                ...baseFilter,
                entryDate: { $gte: today, $lt: tomorrow }
            }),
            
            // By Branch aggregation
            SalesEntry.aggregate([
                { $match: baseFilter },
                { $group: { _id: '$branch', count: { $sum: 1 } } }
            ]),
            
            // By Requirement aggregation
            SalesEntry.aggregate([
                { $match: baseFilter },
                { $group: { _id: '$requirement', count: { $sum: 1 } } }
            ]),
            
            // By SalesPerson aggregation
            SalesEntry.aggregate([
                { $match: baseFilter },
                { $group: { _id: '$salesPerson', count: { $sum: 1 } } },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        name: { $ifNull: ['$user.name', 'Unknown'] },
                        count: 1
                    }
                }
            ]),
            
            // Get all unique status values with counts (to debug what statuses exist)
            SalesEntry.aggregate([
                { $match: baseFilter },
                { $group: { _id: '$queryStatus', count: { $sum: 1 } } }
            ])
        ]);

        // Convert aggregation results to objects
        const byBranch = {};
        byBranchData.forEach(item => {
            if (item._id) byBranch[item._id] = item.count;
        });

        const byRequirement = {};
        byRequirementData.forEach(item => {
            if (item._id) byRequirement[item._id] = item.count;
        });

        const bySalesPerson = {};
        bySalesPersonData.forEach(item => {
            bySalesPerson[item.name] = item.count;
        });

        // Convert status distribution to object (shows actual statuses in DB)
        const statusBreakdown = {};
        statusDistribution.forEach(item => {
            if (item._id) statusBreakdown[item._id] = item.count;
        });

        // Calculate conversion rate
        const conversionRate = totalEntries > 0 
            ? ((closedEntries / totalEntries) * 100).toFixed(2) 
            : 0;

        res.status(200).json({
            success: true,
            data: {
                // Summary stats
                total: totalEntries,
                hot: hotEntries,
                warm: warmEntries,
                cold: coldEntries,
                closed: closedEntries,
                active: activeEntries,
                new: newEntries,
                
                // Overview (for backward compatibility)
                overview: {
                    totalEntries,
                    todayEntries,
                    monthlyEntries,
                    totalFollowUps
                },
                statusWise: {
                    hot: hotEntries,
                    warm: warmEntries,
                    cold: coldEntries,
                    closed: closedEntries,
                    active: activeEntries,
                    new: newEntries
                },
                followUps: {
                    today: todayFollowUps,
                    overdue: overdueFollowUps
                },
                performance: {
                    monthlyConversions: closedEntries,
                    conversionRate: parseFloat(conversionRate)
                },
                
                // NEW analytics data
                byBranch,
                byRequirement,
                bySalesPerson,
                
                // Debug: Shows actual status values in database
                statusBreakdown
            }
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get sales analytics with charts data
// @route   GET /api/dashboard/analytics
// @access  Private
exports.getAnalytics = async (req, res) => {
    try {
        const { period = '30', startDate, endDate } = req.query;

        // Calculate date range
        let dateFrom, dateTo;
        if (startDate && endDate) {
            dateFrom = new Date(startDate);
            dateTo = new Date(endDate);
        } else {
            dateTo = new Date();
            dateFrom = new Date();
            dateFrom.setDate(dateFrom.getDate() - parseInt(period));
        }

        // Base match for aggregation
        const baseMatch = { isActive: true };
        if (req.user.role === 'salesperson') {
            baseMatch.salesPerson = req.user._id;
        }

        // Daily entries trend
        const dailyTrend = await SalesEntry.aggregate([
            {
                $match: {
                    ...baseMatch,
                    entryDate: { $gte: dateFrom, $lte: dateTo }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$entryDate' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Status distribution
        const statusDistribution = await SalesEntry.aggregate([
            { $match: baseMatch },
            {
                $group: {
                    _id: '$queryStatus',
                    count: { $sum: 1 }
                }
            }
        ]);

        // Top performing salespersons (admin only)
        let topPerformers = [];
        if (req.user.role === 'admin' || req.user.role === 'manager') {
            topPerformers = await SalesEntry.aggregate([
                {
                    $match: {
                        isActive: true,
                        entryDate: { $gte: dateFrom, $lte: dateTo }
                    }
                },
                {
                    $group: {
                        _id: '$salesPerson',
                        totalEntries: { $sum: 1 },
                        converted: {
                            $sum: { $cond: [{ $eq: ['$queryStatus', 'converted'] }, 1, 0] }
                        }
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: '$user' },
                {
                    $project: {
                        _id: 1,
                        name: '$user.name',
                        totalEntries: 1,
                        converted: 1,
                        conversionRate: {
                            $cond: [
                                { $eq: ['$totalEntries', 0] },
                                0,
                                { $multiply: [{ $divide: ['$converted', '$totalEntries'] }, 100] }
                            ]
                        }
                    }
                },
                { $sort: { converted: -1, totalEntries: -1 } },
                { $limit: 10 }
            ]);
        }

        // Monthly comparison (current vs previous month)
        const currentMonth = new Date();
        const startOfCurrentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const startOfPreviousMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);

        const [currentMonthStats, previousMonthStats] = await Promise.all([
            SalesEntry.aggregate([
                {
                    $match: {
                        ...baseMatch,
                        entryDate: { $gte: startOfCurrentMonth }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        converted: {
                            $sum: { $cond: [{ $eq: ['$queryStatus', 'converted'] }, 1, 0] }
                        }
                    }
                }
            ]),
            SalesEntry.aggregate([
                {
                    $match: {
                        ...baseMatch,
                        entryDate: { $gte: startOfPreviousMonth, $lt: startOfCurrentMonth }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        converted: {
                            $sum: { $cond: [{ $eq: ['$queryStatus', 'converted'] }, 1, 0] }
                        }
                    }
                }
            ])
        ]);

        // Location-wise distribution
        const locationDistribution = await SalesEntry.aggregate([
            { $match: baseMatch },
            {
                $group: {
                    _id: '$location',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        res.status(200).json({
            success: true,
            data: {
                dailyTrend,
                statusDistribution,
                topPerformers,
                monthComparison: {
                    current: currentMonthStats[0] || { total: 0, converted: 0 },
                    previous: previousMonthStats[0] || { total: 0, converted: 0 }
                },
                locationDistribution
            }
        });
    } catch (error) {
        console.error('Get analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get salesperson performance
// @route   GET /api/dashboard/salesperson-performance
// @access  Private/Admin
exports.getSalespersonPerformance = async (req, res) => {
    try {
        const { salesPersonId, startDate, endDate } = req.query;

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        const matchFilter = { isActive: true };
        if (salesPersonId) {
            matchFilter.salesPerson = salesPersonId;
        }
        if (Object.keys(dateFilter).length > 0) {
            matchFilter.entryDate = dateFilter;
        }

        const performance = await SalesEntry.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: '$salesPerson',
                    totalEntries: { $sum: 1 },
                    newEntries: {
                        $sum: { $cond: [{ $eq: ['$queryStatus', 'new'] }, 1, 0] }
                    },
                    inProgress: {
                        $sum: { $cond: [{ $eq: ['$queryStatus', 'in_progress'] }, 1, 0] }
                    },
                    followUp: {
                        $sum: { $cond: [{ $eq: ['$queryStatus', 'follow_up'] }, 1, 0] }
                    },
                    converted: {
                        $sum: { $cond: [{ $eq: ['$queryStatus', 'converted'] }, 1, 0] }
                    },
                    closed: {
                        $sum: {
                            $cond: [
                                { $in: ['$queryStatus', ['closed', 'not_interested']] },
                                1,
                                0
                            ]
                        }
                    },
                    totalFollowUps: { $sum: '$totalFollowUps' }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    _id: 1,
                    name: '$user.name',
                    email: '$user.email',
                    branch: '$user.branch',
                    totalEntries: 1,
                    newEntries: 1,
                    inProgress: 1,
                    followUp: 1,
                    converted: 1,
                    closed: 1,
                    totalFollowUps: 1,
                    conversionRate: {
                        $cond: [
                            { $eq: ['$totalEntries', 0] },
                            0,
                            {
                                $round: [
                                    { $multiply: [{ $divide: ['$converted', '$totalEntries'] }, 100] },
                                    2
                                ]
                            }
                        ]
                    }
                }
            },
            { $sort: { converted: -1, totalEntries: -1 } }
        ]);

        res.status(200).json({
            success: true,
            count: performance.length,
            data: performance
        });
    } catch (error) {
        console.error('Get salesperson performance error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get recent activities
// @route   GET /api/dashboard/activities
// @access  Private
exports.getRecentActivities = async (req, res) => {
    try {
        const { limit = 20 } = req.query;

        const filter = {};
        if (req.user.role === 'salesperson') {
            filter.addedBy = req.user.id;
        }

        const recentFollowUps = await FollowUp.find(filter)
            .populate('salesEntry', 'companyName contactPerson')
            .populate('addedBy', 'name')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));

        // Get recent sales entries
        const entryFilter = { isActive: true };
        if (req.user.role === 'salesperson') {
            entryFilter.salesPerson = req.user.id;
        }

        const recentEntries = await SalesEntry.find(entryFilter)
            .populate('salesPerson', 'name')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .select('companyName contactPerson queryStatus createdAt salesPerson');

        // Combine and sort by date
        const activities = [
            ...recentFollowUps.map(f => ({
                type: 'followup',
                data: f,
                date: f.createdAt
            })),
            ...recentEntries.map(e => ({
                type: 'entry',
                data: e,
                date: e.createdAt
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date))
         .slice(0, parseInt(limit));

        res.status(200).json({
            success: true,
            data: activities
        });
    } catch (error) {
        console.error('Get recent activities error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};
