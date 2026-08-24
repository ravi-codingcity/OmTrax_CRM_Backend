const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const poController = require('../controllers/purchaseOrderController');
const { protect, authorize, allowDepartment } = require('../middleware/auth');

// Purchase Orders belong to the Purchase department (Admins included).
// Write access is narrowed further to purchase_manager/admin in the controller.
router.use(protect, allowDepartment('purchase'));

const poValidation = [
    body('vendor').trim().notEmpty().withMessage('Vendor is required'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
];

// Helper routes before /:id
router.get('/stats', poController.getPurchaseOrderStats);
router.get('/terms-suggestions', poController.getTermsSuggestions);

router.route('/')
    .get(poController.getPurchaseOrders)
    .post(poValidation, poController.createPurchaseOrder);

router.post('/:id/status', poController.setPurchaseOrderStatus);

router.route('/:id')
    .get(poController.getPurchaseOrder)
    .put(poController.updatePurchaseOrder)
    .delete(authorize('admin', 'director'), poController.deletePurchaseOrder);

module.exports = router;
