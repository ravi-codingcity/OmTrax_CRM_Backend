const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Dashboard routes
router.get('/stats', dashboardController.getDashboardStats);
router.get('/analytics', dashboardController.getAnalytics);
router.get('/activities', dashboardController.getRecentActivities);

// Admin/Manager routes
router.get(
    '/salesperson-performance',
    authorize('admin', 'manager'),
    dashboardController.getSalespersonPerformance
);

module.exports = router;
