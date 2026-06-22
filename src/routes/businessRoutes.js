const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const businessController = require('../controllers/businessController');
const { protect, authorize } = require('../middleware/auth');

// Validation rules
const businessValidation = [
    body('client')
        .trim()
        .notEmpty()
        .withMessage('Client is required'),
    body('jobNumber')
        .trim()
        .notEmpty()
        .withMessage('Job number is required'),
    body('estimateAmount')
        .notEmpty()
        .withMessage('Estimate amount is required')
        .isFloat({ min: 0 })
        .withMessage('Estimate amount must be a positive number')
];

// All routes require authentication
router.use(protect);

// CRUD routes
router.route('/')
    .get(businessController.getBusinessEntries)
    .post(businessValidation, businessController.createBusiness);

router.route('/:id')
    .get(businessController.getBusiness)
    .put(businessController.updateBusiness)
    .delete(authorize('admin'), businessController.deleteBusiness);

module.exports = router;
