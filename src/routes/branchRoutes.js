const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const branchController = require('../controllers/branchController');
const { protect, authorize } = require('../middleware/auth');

// Validation rules
const branchValidation = [
    body('name')
        .trim()
        .notEmpty()
        .withMessage('Branch name is required'),
    body('code')
        .trim()
        .notEmpty()
        .withMessage('Branch code is required')
        .isLength({ min: 2, max: 10 })
        .withMessage('Branch code must be 2-10 characters')
];

// All routes require authentication
router.use(protect);

// Public routes (for authenticated users)
router.get('/', branchController.getBranches);
router.get('/:id', branchController.getBranch);

// Admin routes
router.post('/', authorize('admin'), branchValidation, branchController.createBranch);
router.put('/:id', authorize('admin'), branchController.updateBranch);
router.delete('/:id', authorize('admin'), branchController.deleteBranch);

module.exports = router;
