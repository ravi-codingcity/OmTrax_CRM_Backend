const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const salesController = require('../controllers/salesController');
const { protect, authorize } = require('../middleware/auth');

// Validation rules
const salesEntryValidation = [
    body('companyName')
        .trim()
        .notEmpty()
        .withMessage('Company name is required'),
    body('contactPerson')
        .trim()
        .notEmpty()
        .withMessage('Contact person is required'),
    body('contactNumber')
        .trim()
        .notEmpty()
        .withMessage('Contact number is required'),
    body('contactEmail')
        .optional()
        .isEmail()
        .withMessage('Please enter a valid email')
        .normalizeEmail()
];

// All routes require authentication
router.use(protect);

// Follow-up specific routes (must be before /:id routes)
router.get('/follow-ups/today', salesController.getTodayFollowUps);
router.get('/follow-ups/overdue', salesController.getOverdueFollowUps);

// CRUD routes
router.route('/')
    .get(salesController.getSalesEntries)
    .post(salesEntryValidation, salesController.createSalesEntry);

router.route('/:id')
    .get(salesController.getSalesEntry)
    .put(salesController.updateSalesEntry)
    .delete(authorize('admin', 'manager'), salesController.deleteSalesEntry);

module.exports = router;
