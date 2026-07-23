const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const requireAuthAccessKey = require('../middleware/authAccessKey');

// Throttle credential-guessing. Keyed by IP + submitted username so a single
// attacker cannot lock every user out from one shared IP.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyBy: (req) => (req.body?.username || '').toLowerCase()
});
const resetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    keyBy: (req) => (req.body?.username || '').toLowerCase()
});
// Caps mass account creation even if the signup link is shared around
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });

// Validation rules
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

const resetPasswordValidation = [
    body('username')
        .trim()
        .notEmpty()
        .withMessage('Username is required'),
    body('oldPassword')
        .notEmpty()
        .withMessage('Old password is required'),
    body('newPassword')
        .isLength({ min: 5 })
        .withMessage('New password must be at least 5 characters')
];

// Login stays open (rate-limited) — it is the entry point for every user.
router.post('/login', loginLimiter, loginValidation, authController.login);

// Sign Up and Reset Password are URL-authenticated: the caller must present the
// shared access key that is embedded in their page URL. Enforced here so the
// endpoints cannot be used by hitting the API directly without the key.
// Lets the SPA confirm a link's key before rendering the form (404 if wrong)
router.get('/access-check', requireAuthAccessKey, (req, res) =>
    res.status(200).json({ success: true })
);

router.post('/signup', requireAuthAccessKey, signupLimiter, signupValidation, authController.signup);
router.post('/reset-password', requireAuthAccessKey, resetLimiter, resetPasswordValidation, authController.resetPassword);

// Protected routes
router.get('/me', protect, authController.getMe);
router.put('/update-password', protect, authController.updatePassword);

// Admin routes
router.get('/users', protect, authorize('admin'), authController.getAllUsers);
router.put('/users/:id', protect, authorize('admin'), authController.updateUser);

module.exports = router;
