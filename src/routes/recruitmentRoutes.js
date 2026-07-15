const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const recruitmentController = require('../controllers/recruitmentController');
const { protect, authorize } = require('../middleware/auth');

const createValidation = [
    body('clientName').trim().notEmpty().withMessage('Client name is required'),
    body('position').trim().notEmpty().withMessage('Position is required')
];

// All routes require authentication
router.use(protect);

// Helper / list routes (before /:id)
router.get('/recruiters', recruitmentController.getRecruiters);
router.get('/stats', recruitmentController.getStats);

router.route('/')
    .get(recruitmentController.getEntries)
    .post(createValidation, recruitmentController.createEntry);

// Generate a requirement from an existing "HR & Recruitment" Sales Entry
router.post('/from-sales/:salesEntryId', recruitmentController.createFromSales);

router.put('/:id/reassign', recruitmentController.reassignEntry);

router.route('/:id')
    .get(recruitmentController.getEntry)
    .put(recruitmentController.updateEntry)
    .delete(authorize('admin'), recruitmentController.deleteEntry);

module.exports = router;
