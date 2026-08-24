const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const rcController = require('../controllers/rateComparisonController');
const { protect, authorize, allowDepartment } = require('../middleware/auth');

// Rate comparisons belong to the Purchase department. Administrators (Admin and
// Director) pass allowDepartment, which is what lets the Director review them.
// Approval authority is narrowed to admin-level inside the controller.
router.use(protect, allowDepartment('purchase'));

const rcValidation = [
    body('materialName').trim().notEmpty().withMessage('Material name is required'),
    body('requiredQuantity').notEmpty().withMessage('Required quantity is required')
        .isFloat({ gt: 0 }).withMessage('Required quantity must be greater than zero'),
];

// Helper routes before /:id
router.get('/stats', rcController.getRateComparisonStats);

router.route('/')
    .get(rcController.getRateComparisons)
    .post(rcValidation, rcController.createRateComparison);

// Workflow actions
router.post('/:id/submit', rcController.submitForApproval);
router.post('/:id/decision', rcController.decide);

router.route('/:id')
    .get(rcController.getRateComparison)
    .put(rcController.updateRateComparison)
    .delete(authorize('admin', 'director'), rcController.deleteRateComparison);

module.exports = router;
