const express = require('express');
const router = express.Router();
const salesVisitController = require('../controllers/salesVisitController');
const { protect } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

// All routes require authentication
router.use(protect);

// Routes
router.get('/', salesVisitController.getSalesVisits);
router.get('/summary', salesVisitController.getVisitsSummary);
router.get('/:id', salesVisitController.getSalesVisit);
router.post('/', upload.single('image'), salesVisitController.createSalesVisit);
router.delete('/:id', salesVisitController.deleteSalesVisit);

module.exports = router;
