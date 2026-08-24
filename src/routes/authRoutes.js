const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

// Throttle credential-guessing. Keyed by IP + submitted username so a single
// attacker cannot lock every user out from one shared IP.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyBy: (req) => (req.body?.username || '').toLowerCase()
});

// Validation rules (shared by admin user-creation)
const signupValidation = [
    body('username')
        .trim()
        .isLength({ min: 3 })
        .withMessage('Username must be at least 3 characters'),
    body('password')
        .isLength({ min: 5 })
        .withMessage('Password must be at least 5 characters'),
    body('name')
        .trim()
        .notEmpty()
        .withMessage('Name is required'),
    body('email')
        .isEmail()
        .withMessage('Please enter a valid email')
        .normalizeEmail()
];

const loginValidation = [
    body('username')
        .trim()
        .notEmpty()
        .withMessage('Username is required'),
    body('password')
        .notEmpty()
        .withMessage('Password is required')
];

// Login is the only public auth route (rate-limited). Account creation and
// password resets are handled by admins in the User Management panel — there is
// no self-service signup / reset flow.
router.post('/login', loginLimiter, loginValidation, authController.login);

// Protected routes
router.get('/me', protect, authController.getMe);
router.put('/update-password', protect, authController.updatePassword);

// Admin routes — User Management (admin only, enforced here + in controller)
router.use('/users', protect, authorize('admin', 'director'));
router.route('/users')
    .get(authController.getAllUsers)
    .post(signupValidation, authController.createUser);
router.route('/users/:id')
    .put(authController.updateUser)
    .delete(authController.deleteUser);
router.put('/users/:id/password', authController.adminResetPassword);

module.exports = router;
