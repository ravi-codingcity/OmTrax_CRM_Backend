const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const vendorController = require('../controllers/vendorController');
const vendorDocumentController = require('../controllers/vendorDocumentController');
const { protect, authorize } = require('../middleware/auth');

// Vendors are shared between Purchase and Finance, so this router is NOT gated
// by allowDepartment(). Access is decided per-role inside the controller
// (canViewVendors / canEditVendors / canGenerateKycLink / canReviewKyc).
router.use(protect);

const vendorValidation = [
    body('vendorName').trim().notEmpty().withMessage('Vendor name is required'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid email'),
];

// Helper routes before /:id
router.get('/stats', vendorController.getVendorStats);

// Two independent entry points into the register:
//   POST /            -> Add Vendor manually (never mints a KYC link)
//   POST /kyc-request -> Generate KYC Link and let the vendor fill it in
router.post('/kyc-request', vendorController.createKycRequest);

router.route('/')
    .get(vendorController.getVendors)
    .post(vendorValidation, vendorController.createVendor);

// KYC link management (Purchase Manager, Finance, Admin)
router.post('/:id/kyc-link', vendorController.generateKycLink);
router.post('/:id/kyc-link/sent', vendorController.markKycLinkSent);

// KYC review — Finance and Admin only (enforced in the controller)
router.post('/:id/kyc/review', vendorController.startKycReview);
router.post('/:id/kyc/decision', vendorController.decideKyc);

// KYC documents — signed, expiring URLs issued only to authorised callers.
// Available to Purchase AND Finance so both can view and download.
router.get('/:id/documents', vendorDocumentController.listDocuments);
router.get('/:id/documents/:docId', vendorDocumentController.openDocument);

router.route('/:id')
    .get(vendorController.getVendor)
    .put(vendorController.updateVendor)
    .delete(authorize('admin', 'director'), vendorController.deleteVendor);

module.exports = router;
