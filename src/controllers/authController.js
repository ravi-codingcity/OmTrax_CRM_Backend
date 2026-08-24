const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { jwtSecret, jwtExpire } = require('../config/constants');
const {
    DEFAULT_DEPARTMENT,
    isValidDepartment,
    ROLES_BY_DEPARTMENT,
    CROSS_DEPARTMENT_ROLES,
    ADMIN_LEVEL_ROLES,
    resolveDepartment,
    departmentQuery,
} = require('../utils/department');

// Generate JWT Token
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, jwtSecret, { expiresIn: jwtExpire });
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// True when the given user is the only administrator left — used to stop an
// admin from locking everyone out by demoting/deactivating/deleting themselves.
// Director counts here because it carries the same CRM authority as Admin, so
// an organisation with an active Director is not locked out.
const isLastActiveAdmin = async (userId) => {
    const otherAdmins = await User.countDocuments({
        role: { $in: ADMIN_LEVEL_ROLES },
        isActive: true,
        _id: { $ne: userId }
    });
    return otherAdmins === 0;
};

// Validate that a role is allowed. Admin is shared across departments; every
// other role must belong to the chosen department. business_sub is created only
// via the admin script, never through this UI.
const isRoleAllowedForDept = (role, department) => {
    // Admin and Director are cross-department — valid whichever department is picked
    if (CROSS_DEPARTMENT_ROLES.includes(role)) return true;
    if (role === 'business_sub') return false;
    return (ROLES_BY_DEPARTMENT[department] || []).includes(role);
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { username, password } = req.body;

        // Find user by username and include password
        const user = await User.findOne({ username }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Account is deactivated. Please contact admin.'
            });
        }

        // Check password
        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Generate token
        const token = generateToken(user._id);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user,
                token
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login',
            error: error.message
        });
    }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        console.error('GetMe error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Update user password
// @route   PUT /api/auth/update-password
// @access  Private
exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const user = await User.findById(req.user.id).select('+password');

        // Check current password
        const isMatch = await user.comparePassword(currentPassword);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        user.password = newPassword;
        await user.save();

        // Generate new token
        const token = generateToken(user._id);

        res.status(200).json({
            success: true,
            message: 'Password updated successfully',
            data: { token }
        });
    } catch (error) {
        console.error('Update password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get all users (Admin only)
// @route   GET /api/auth/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
    try {
        const { role, branch, isActive, search, scope } = req.query;

        // `req.query.department` is deliberately NOT read as a filter here.
        //
        // The client's Axios interceptor appends department=<activeDepartment>
        // to every request as ambient context. Using it as a filter as well
        // silently defeated scope=all: the Users page returned only the
        // department currently being browsed. Ambient context is the job of
        // resolveDepartment(); an explicit filter gets its own parameter.
        const explicitDepartment = req.query.filterDepartment;

        // The Users page passes scope=all to see every department. Everything
        // else (e.g. Assign Leads) stays scoped to the active department.
        const filter = scope === 'all'
            ? {}
            : { ...departmentQuery(resolveDepartment(req)) };

        if (explicitDepartment) filter.department = explicitDepartment;
        if (role) filter.role = role;
        if (branch) filter.branch = branch;
        if (isActive !== undefined) filter.isActive = isActive === 'true';
        if (search && search.trim()) {
            const rx = new RegExp(escapeRegex(search.trim()), 'i');
            filter.$or = [{ name: rx }, { username: rx }, { email: rx }];
        }

        const users = await User.find(filter).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: users.length,
            data: users
        });
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Update user (Admin only)
// @route   PUT /api/auth/users/:id
// @access  Private/Admin
exports.updateUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const { name, email, role, department, branch, phoneNumber, isActive } = req.body;

        // Resolve the department a new role would live in (for validation)
        const targetDept = (department !== undefined && isValidDepartment(department))
            ? department
            : user.department;

        if (role !== undefined && !isRoleAllowedForDept(role, targetDept)) {
            return res.status(400).json({
                success: false,
                message: `Role '${role}' is not valid for the ${targetDept} department`
            });
        }

        // Safety: don't let the last active admin be demoted or deactivated
        const demotingLastAdmin = ADMIN_LEVEL_ROLES.includes(user.role) &&
            ((role !== undefined && !ADMIN_LEVEL_ROLES.includes(role)) || isActive === false);
        if (demotingLastAdmin && await isLastActiveAdmin(user._id)) {
            return res.status(400).json({
                success: false,
                message: 'This is the last active administrator — make another user an Admin or Director first.'
            });
        }

        if (name !== undefined) user.name = name;
        if (email !== undefined) user.email = email;
        if (department !== undefined && isValidDepartment(department)) user.department = department;
        if (role !== undefined) user.role = role;
        if (branch !== undefined) user.branch = branch;
        if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
        if (isActive !== undefined) user.isActive = isActive;

        await user.save();

        res.status(200).json({
            success: true,
            message: 'User updated successfully',
            data: user
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'That email or username is already in use.' });
        }
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Create a user (Admin User Management — no access key, no auto-login)
// @route   POST /api/auth/users
// @access  Private/Admin
exports.createUser = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { username, password, name, email, role, branch, phoneNumber, isActive } = req.body;
        const department = isValidDepartment(req.body.department) ? req.body.department : DEFAULT_DEPARTMENT;
        const finalRole = role || (department === DEFAULT_DEPARTMENT ? 'salesperson' : 'recruiter');

        if (!isRoleAllowedForDept(finalRole, department)) {
            return res.status(400).json({
                success: false,
                message: `Role '${finalRole}' is not valid for the ${department} department`
            });
        }

        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: existingUser.username === username ? 'Username already exists' : 'Email already exists'
            });
        }

        const user = await User.create({
            username,
            password,
            name,
            email,
            role: finalRole,
            department,
            branch,
            phoneNumber,
            isActive: isActive !== undefined ? !!isActive : true
        });

        res.status(201).json({ success: true, message: 'User created successfully', data: user });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'That email or username is already in use.' });
        }
        console.error('Create user error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Reset a user's password (Admin — no old password required)
// @route   PUT /api/auth/users/:id/password
// @access  Private/Admin
exports.adminResetPassword = async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 5) {
            return res.status(400).json({ success: false, message: 'New password must be at least 5 characters' });
        }

        const user = await User.findById(req.params.id).select('+password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.password = newPassword; // hashed by the pre-save hook
        await user.save();

        res.status(200).json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.error('Admin reset password error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Delete a user (Admin)
// @route   DELETE /api/auth/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (ADMIN_LEVEL_ROLES.includes(user.role) && await isLastActiveAdmin(user._id)) {
            return res.status(400).json({ success: false, message: 'Cannot delete the last active administrator.' });
        }

        await User.deleteOne({ _id: user._id });

        res.status(200).json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
