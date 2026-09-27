const express = require('express');
const router = express.Router();
const rcController = require('../controllers/rateComparisonController');
const { protect, authorize, allowDepartment } = require('../middleware/auth');

// Rate comparisons belong to the Purchase department. Administrators (Admin and
// Director) pass allowDepartment, which is what lets the Director review them.
// Approval authority is narrowed to admin-level inside the controller.
router.use(protect, allowDepartment('purchase'));

// Helper routes before /:id
router.get('/stats', rcController.getRateComparisonStats);

router.route('/')
    .get(rcController.getRateComparisons)
    // Items, quantities and quotations are validated in rateComparisonService,
    // which understands multi-item comparisons
    .post(rcController.createRateComparison);

// Workflow actions
router.post('/:id/submit', rcController.submitForApproval);
router.post('/:id/decision', rcController.decide);

router.route('/:id')
    .get(rcController.getRateComparison)
    .put(rcController.updateRateComparison)
    .delete(authorize('admin', 'director'), rcController.deleteRateComparison);

module.exports = router;
