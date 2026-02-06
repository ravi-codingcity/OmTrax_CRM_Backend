const express = require('express');
const router = express.Router();
const followUpController = require('../controllers/followUpController');
const { protect, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Custom routes
router.get('/my', followUpController.getMyFollowUps);
router.get('/sales/:salesEntryId', followUpController.getFollowUpsBySalesEntry);

// CRUD routes
router.route('/')
    .post(followUpController.addFollowUp);

router.route('/:id')
    .get(followUpController.getFollowUp)
    .put(followUpController.updateFollowUp)
    .delete(authorize('admin'), followUpController.deleteFollowUp);

module.exports = router;
