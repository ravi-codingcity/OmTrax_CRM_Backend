const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// User routes
router.get('/', notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.get('/reminders', notificationController.getReminders);
router.put('/reminders/dismiss-all', notificationController.dismissAllReminders);
router.put('/reminders/:id/dismiss', notificationController.dismissReminder);
router.put('/read-all', notificationController.markAllAsRead);
router.put('/:id/read', notificationController.markAsRead);
router.delete('/clear-read', notificationController.clearReadNotifications);
router.delete('/:id', notificationController.deleteNotification);

// Admin routes
router.post('/', authorize('admin'), notificationController.createNotification);
router.post('/generate-overdue', authorize('admin'), notificationController.generateOverdueNotifications);

module.exports = router;
