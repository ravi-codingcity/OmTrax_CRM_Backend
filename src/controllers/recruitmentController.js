const RecruitmentEntry = require('../models/RecruitmentEntry');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { validationResult } = require('express-validator');

// Fields the assigned recruiter owns
const RECRUITER_FIELDS = ['cvSubmissionDate', 'cvsSubmitted', 'feedback', 'remarks'];
// Fields set when assigning a requirement (Admin / Team Leader)
const ASSIGNMENT_FIELDS = ['salesPersonName', 'positionReceivedDate', 'clientName', 'position'];

const isAdmin = (u) => u.role === 'admin';
const isTeamLeader = (u) => u.role === 'team_leader';
const canManage = (u) => isAdmin(u) || isTeamLeader(u); // can create / assign / reassign

// Build the role-based scope for which entries a user may see.
const scopeForUser = (user) => {
    if (isAdmin(user)) return {};
    if (isTeamLeader(user)) return { assignedBy: user.id };
    // Recruiter (or any other HR role): only their own assigned tasks
    return { $or: [{ recruiter: user.id }, { recruiterName: user.name }] };
};

// Resolve a recruiter reference from an id and/or a name (fixed recruiter team).
const resolveRecruiter = async ({ recruiter, recruiterName }) => {
    if (recruiter) {
        const u = await User.findById(recruiter);
        if (u) return { id: u._id, name: u.name };
    }
    if (recruiterName) {
        const u = await User.findOne({ name: recruiterName, department: 'hr' });
        return { id: u ? u._id : undefined, name: recruiterName };
    }
    return { id: undefined, name: undefined };
};

const notifyRecruiter = async (entry, type, actor) => {
    if (!entry.recruiter) return;
    try {
        await Notification.create({
            type,
            companyName: `${entry.position} @ ${entry.clientName}`,
            salesPerson: actor.id,
            salesPersonName: actor.name,
            remark: entry.remarks,
            forUser: entry.recruiter,
            forRole: 'team_leader',
            department: 'hr'
        });
    } catch (err) {
        console.error('HR notification failed:', err);
    }
};

// @desc    Create a recruitment requirement (Admin / Team Leader)
// @route   POST /api/recruitment
// @access  Private (admin, team_leader)
exports.createEntry = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }
        if (!canManage(req.user)) {
            return res.status(403).json({ success: false, message: 'Only Admins and Team Leaders can create requirements' });
        }

        const { id: recruiterId, name: recruiterName } = await resolveRecruiter(req.body);

        const data = {
            salesPersonName: req.body.salesPersonName,
            // Auto-captured on creation — not entered manually
            positionReceivedDate: new Date(),
            clientName: req.body.clientName,
            position: req.body.position,
            recruiter: recruiterId,
            recruiterName,
            assignedBy: req.user.id,
            assignedByName: req.user.name,
            department: 'hr',
            entryDate: req.body.entryDate || new Date(),
            // Auto-capture the assignment date
            assignDate: new Date()
        };
        // Admins may also seed recruiter fields on creation
        if (isAdmin(req.user)) {
            RECRUITER_FIELDS.forEach((f) => {
                if (req.body[f] !== undefined) data[f] = req.body[f];
            });
        }

        const entry = await RecruitmentEntry.create(data);
        await notifyRecruiter(entry, 'hr_assignment', req.user);

        const populated = await RecruitmentEntry.findById(entry._id)
            .populate('recruiter', 'name username')
            .populate('assignedBy', 'name username');

        res.status(201).json({ success: true, message: 'Requirement assigned successfully', data: populated });
    } catch (error) {
        console.error('Create recruitment entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Get recruitment entries (role-based)
// @route   GET /api/recruitment
// @access  Private (HR)
exports.getEntries = async (req, res) => {
    try {
        const { search, recruiterName, page = 1, limit = 1000 } = req.query;
        const filter = { isActive: true, ...scopeForUser(req.user) };

        if (recruiterName) filter.recruiterName = recruiterName;
        if (search) {
            filter.$and = [{
                $or: [
                    { clientName: { $regex: search, $options: 'i' } },
                    { position: { $regex: search, $options: 'i' } },
                    { recruiterName: { $regex: search, $options: 'i' } },
                    { salesPersonName: { $regex: search, $options: 'i' } }
                ]
            }];
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);

        const [entries, total] = await Promise.all([
            RecruitmentEntry.find(filter)
                .populate('recruiter', 'name username')
                .populate('assignedBy', 'name username')
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            RecruitmentEntry.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            data: entries,
            pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum), totalRecords: total }
        });
    } catch (error) {
        console.error('Get recruitment entries error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Dashboard stats (role-based aggregation)
// @route   GET /api/recruitment/stats
// @access  Private (HR)
exports.getStats = async (req, res) => {
    try {
        const match = { isActive: true, ...scopeForUser(req.user) };
        const shortlisted = { $sum: { $cond: [{ $eq: ['$feedback', 'Short Listed'] }, 1, 0] } };

        const [totalsArr, feedbackArr, byRecruiter, byClient] = await Promise.all([
            RecruitmentEntry.aggregate([
                { $match: match },
                { $group: { _id: null, total: { $sum: 1 }, cvsSubmitted: { $sum: '$cvsSubmitted' } } }
            ]),
            RecruitmentEntry.aggregate([
                { $match: match },
                { $group: { _id: '$feedback', count: { $sum: 1 } } }
            ]),
            RecruitmentEntry.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$recruiterName',
                        requirements: { $sum: 1 },
                        cvsSubmitted: { $sum: '$cvsSubmitted' },
                        shortlisted
                    }
                },
                { $sort: { shortlisted: -1, requirements: -1 } }
            ]),
            RecruitmentEntry.aggregate([
                { $match: match },
                { $group: { _id: '$clientName', requirements: { $sum: 1 }, cvsSubmitted: { $sum: '$cvsSubmitted' } } },
                { $sort: { requirements: -1 } },
                { $limit: 8 }
            ])
        ]);

        const totals = totalsArr[0] || {};
        const feedback = { 'Short Listed': 0, Hold: 0, Rejected: 0, 'Feedback Pending': 0 };
        feedbackArr.forEach((f) => { feedback[f._id || 'Feedback Pending'] = f.count; });

        res.status(200).json({
            success: true,
            data: {
                totals: {
                    total: totals.total || 0,
                    cvsSubmitted: totals.cvsSubmitted || 0
                },
                feedback,
                byRecruiter: byRecruiter.map((r) => ({ name: r._id || 'Unassigned', ...r })),
                byClient: byClient.map((c) => ({ name: c._id || 'Unknown', ...c }))
            }
        });
    } catch (error) {
        console.error('Get recruitment stats error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Get single entry
// @route   GET /api/recruitment/:id
// @access  Private (HR)
exports.getEntry = async (req, res) => {
    try {
        const entry = await RecruitmentEntry.findById(req.params.id)
            .populate('recruiter', 'name username')
            .populate('assignedBy', 'name username');
        if (!entry) return res.status(404).json({ success: false, message: 'Requirement not found' });

        // Access check
        if (!isAdmin(req.user)) {
            const ownsAsTL = isTeamLeader(req.user) && String(entry.assignedBy?._id || entry.assignedBy) === req.user.id;
            const ownsAsRecruiter = String(entry.recruiter?._id || entry.recruiter) === req.user.id || entry.recruiterName === req.user.name;
            if (!ownsAsTL && !ownsAsRecruiter) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        }
        res.status(200).json({ success: true, data: entry });
    } catch (error) {
        console.error('Get recruitment entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Update an entry (progress and/or assignment depending on role)
// @route   PUT /api/recruitment/:id
// @access  Private (HR)
exports.updateEntry = async (req, res) => {
    try {
        const entry = await RecruitmentEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Requirement not found' });

        const isAssignedRecruiter =
            String(entry.recruiter || '') === req.user.id || entry.recruiterName === req.user.name;
        const isOwningTL = isTeamLeader(req.user) && String(entry.assignedBy || '') === req.user.id;

        // Decide which fields this user may change
        // - Admin: full access (assignment + recruiter-owned data)
        // - Owning Team Leader: only the assignment data they created (NOT recruiter data)
        // - Assigned Recruiter: only their own recruiter-owned data
        let allowed = [];
        if (isAdmin(req.user)) {
            allowed = [...ASSIGNMENT_FIELDS, ...RECRUITER_FIELDS];
        } else if (isOwningTL) {
            allowed = [...ASSIGNMENT_FIELDS];
        } else if (isAssignedRecruiter) {
            allowed = [...RECRUITER_FIELDS];
        } else {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const updates = {};
        allowed.forEach((f) => {
            if (req.body[f] !== undefined) updates[f] = req.body[f];
        });

        const updated = await RecruitmentEntry.findByIdAndUpdate(req.params.id, updates, {
            new: true, runValidators: true
        }).populate('recruiter', 'name username').populate('assignedBy', 'name username');

        // Recruiter progress updates flow back to the assigner + admins
        if (isAssignedRecruiter && !isAdmin(req.user) && !isOwningTL) {
            try {
                await Notification.create({
                    type: 'hr_update',
                    companyName: `${updated.position} @ ${updated.clientName}`,
                    salesPerson: req.user.id,
                    salesPersonName: req.user.name,
                    remark: updated.remarks,
                    forUser: updated.assignedBy,
                    forRole: 'admin',
                    department: 'hr'
                });
            } catch (err) {
                console.error('HR update notification failed:', err);
            }
        }

        res.status(200).json({ success: true, message: 'Requirement updated successfully', data: updated });
    } catch (error) {
        console.error('Update recruitment entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Reassign a requirement to another recruiter (Admin / Team Leader)
// @route   PUT /api/recruitment/:id/reassign
// @access  Private (admin, team_leader)
exports.reassignEntry = async (req, res) => {
    try {
        if (!canManage(req.user)) {
            return res.status(403).json({ success: false, message: 'Only Admins and Team Leaders can reassign' });
        }
        const entry = await RecruitmentEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Requirement not found' });

        if (isTeamLeader(req.user) && String(entry.assignedBy || '') !== req.user.id) {
            return res.status(403).json({ success: false, message: 'You can only reassign requirements you assigned' });
        }

        const { id: newRecruiterId, name: newRecruiterName } = await resolveRecruiter(req.body);
        if (!newRecruiterName) {
            return res.status(400).json({ success: false, message: 'A recruiter is required' });
        }

        // Preserve history
        entry.previousRecruiters.push({
            recruiter: entry.recruiter,
            recruiterName: entry.recruiterName,
            reassignedBy: req.user.id,
            reassignedByName: req.user.name,
            reassignedAt: new Date()
        });
        entry.recruiter = newRecruiterId;
        entry.recruiterName = newRecruiterName;
        // New assignment → refresh the assign date
        entry.assignDate = new Date();
        await entry.save();

        await notifyRecruiter(entry, 'hr_assignment', req.user);

        const populated = await RecruitmentEntry.findById(entry._id)
            .populate('recruiter', 'name username')
            .populate('assignedBy', 'name username');

        res.status(200).json({ success: true, message: `Reassigned to ${newRecruiterName}`, data: populated });
    } catch (error) {
        console.error('Reassign recruitment entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Delete an entry (soft delete) - Admin only
// @route   DELETE /api/recruitment/:id
// @access  Private/Admin
exports.deleteEntry = async (req, res) => {
    try {
        const entry = await RecruitmentEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, message: 'Requirement not found' });
        entry.isActive = false;
        await entry.save();
        res.status(200).json({ success: true, message: 'Requirement deleted successfully' });
    } catch (error) {
        console.error('Delete recruitment entry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    List recruiters in the HR department (for assignment dropdowns)
// @route   GET /api/recruitment/recruiters
// @access  Private (HR)
exports.getRecruiters = async (req, res) => {
    try {
        const recruiters = await User.find({ department: 'hr', role: 'recruiter', isActive: true })
            .select('name username')
            .sort({ name: 1 });
        res.status(200).json({ success: true, data: recruiters });
    } catch (error) {
        console.error('Get recruiters error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
