const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const purchaseController = require('../controllers/purchaseController');
const itemController = require('../controllers/itemController');
const supplierController = require('../controllers/supplierController');
const storageLocationController = require('../controllers/storageLocationController');
const { protect, authorize, allowDepartment } = require('../middleware/auth');

const entryValidation = [
    body('itemName').trim().notEmpty().withMessage('Item name is required'),
    body('quantityPurchased').notEmpty().withMessage('Quantity is required').isFloat({ min: 0 }).withMessage('Quantity must be a positive number')
];

// All purchase routes require auth + membership of the purchase department (or admin)
router.use(protect, allowDepartment('purchase'));

// Item catalogue / autocomplete
router.route('/items')
    .get(itemController.getItems)
    .post(itemController.createItem);

// Supplier master / autocomplete
router.route('/suppliers')
    .get(supplierController.getSuppliers)
    .post(supplierController.createSupplier);

// Storage location master (warehouse / branch) / autocomplete
router.route('/locations')
    .get(storageLocationController.getLocations)
    .post(storageLocationController.createLocation);

// Inventory & dashboard
router.get('/inventory', purchaseController.getInventory);
router.get('/stats', purchaseController.getStats);

// Purchase entries
router.route('/entries')
    .get(purchaseController.getEntries)
    .post(entryValidation, purchaseController.createEntry);

// Lifecycle actions (before /:id catch-all patterns)
router.post('/entries/:id/dispatch', purchaseController.addDispatch);
router.post('/entries/:id/return', purchaseController.addReturn);

router.route('/entries/:id')
    .get(purchaseController.getEntry)
    .put(purchaseController.updateEntry)
    .delete(authorize('admin'), purchaseController.deleteEntry);

module.exports = router;
