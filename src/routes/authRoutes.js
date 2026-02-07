const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

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

// Public routes
router.post('/signup', signupValidation, authController.signup);
router.post('/login', loginValidation, authController.login);
router.post('/reset-password', resetPasswordValidation, authController.resetPassword);

// Protected routes
router.get('/me', protect, authController.getMe);
router.put('/update-password', protect, authController.updatePassword);

// Admin routes
router.get('/users', protect, authorize('admin'), authController.getAllUsers);
router.put('/users/:id', protect, authorize('admin'), authController.updateUser);

module.exports = router;
