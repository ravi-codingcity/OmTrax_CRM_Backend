const express = require('express');
const router = express.Router();
const salesVisitController = require('../controllers/salesVisitController');
const { protect } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

// All routes require authentication
router.use(protect);

// Smart middleware - handles both FormData and JSON
const handleUpload = (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    
    // If JSON request, skip multer and go directly to controller
    if (contentType.includes('application/json')) {
        console.log('JSON request - skipping multer');
        return next();
    }
    
    // If multipart/form-data, use multer
    if (contentType.includes('multipart/form-data')) {
        console.log('Multipart request - using multer');
        upload.single('image')(req, res, (err) => {
            if (err) {
                console.error('Multer/Cloudinary upload error:', err);
                return res.status(400).json({
                    success: false,
                    message: 'Image upload failed',
                    error: err.message
                });
            }
            next();
        });
    } else {
        // Other content types, just proceed
        next();
    }
};

// Routes
router.get('/', salesVisitController.getSalesVisits);
router.get('/summary', salesVisitController.getVisitsSummary);
router.get('/:id', salesVisitController.getSalesVisit);

// Create visit - supports both:
// 1. multipart/form-data with 'image' file
// 2. application/json with 'imageBase64' field
router.post('/', handleUpload, salesVisitController.createSalesVisit);

router.delete('/:id', salesVisitController.deleteSalesVisit);

module.exports = router;
