const SalesVisit = require('../models/SalesVisit');
const { deleteImage, cloudinary } = require('../config/cloudinary');

// @desc    Get all sales visits (admin gets all, salesperson gets own)
// @route   GET /api/sales-visits
// @access  Private
exports.getSalesVisits = async (req, res) => {
    try {
        const { page = 1, limit = 50, date, startDate, endDate } = req.query;

        // Build filter - admin sees all, others see only their own
        const filter = {};
        if (req.user.role !== 'admin') {
            filter.salesPerson = req.user.id;
        }

        // Date filtering
        if (date) {
            filter.date = date;
        } else if (startDate || endDate) {
            filter.date = {};
            if (startDate) filter.date.$gte = startDate;
            if (endDate) filter.date.$lte = endDate;
        }

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;

        const [visits, total] = await Promise.all([
            SalesVisit.find(filter)
                .populate('salesPerson', 'name username email')
                .sort({ date: -1, time: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(), // Use lean() for faster queries on mobile
            SalesVisit.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            data: visits,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum),
                totalRecords: total,
                hasNextPage: pageNum * limitNum < total
            }
        });
    } catch (error) {
        console.error('Get sales visits error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get single sales visit
// @route   GET /api/sales-visits/:id
// @access  Private
exports.getSalesVisit = async (req, res) => {
    try {
        const visit = await SalesVisit.findById(req.params.id)
            .populate('salesPerson', 'name username email phoneNumber');

        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Sales visit not found'
            });
        }

        // Check access - admin can see all, others only their own
        if (req.user.role !== 'admin' && visit.salesPerson._id.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        res.status(200).json({
            success: true,
            data: visit
        });
    } catch (error) {
        console.error('Get sales visit error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Create new sales visit
// @route   POST /api/sales-visits
// @access  Private
exports.createSalesVisit = async (req, res) => {
    try {
        console.log('=== Sales Visit Creation ===');
        console.log('Content-Type:', req.headers['content-type']);
        console.log('Body keys:', Object.keys(req.body));
        console.log('Has imageBase64:', !!req.body.imageBase64);
        console.log('Has image:', !!req.body.image);
        console.log('File from multer:', req.file ? 'Present' : 'Not present');
        
        const { companyName, location, latitude, longitude, date, time, notes } = req.body;
        
        // Check for image in multiple possible fields
        const imageBase64 = req.body.imageBase64 || req.body.image || req.body.photo || req.body.capturedImage;

        // Build visit data
        const visitData = {
            companyName,
            location,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            date,
            time,
            notes,
            salesPerson: req.user.id,
            salesPersonName: req.user.name,
            timestamp: new Date()
        };

        // Handle image - try multiple methods
        
        // Method 1: File uploaded via multer (FormData with file)
        if (req.file) {
            console.log('Image received via multer');
            visitData.imageUrl = req.file.path || req.file.secure_url || req.file.url;
            visitData.imagePublicId = req.file.filename || req.file.public_id;
        }
        // Method 2: Base64 image from Capacitor camera
        else if (imageBase64) {
            console.log('Image received as base64, length:', imageBase64.length);
            console.log('Base64 starts with:', imageBase64.substring(0, 50));
            
            // Verify Cloudinary is configured
            if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
                console.error('Cloudinary credentials not configured!');
                return res.status(500).json({
                    success: false,
                    message: 'Server configuration error: Cloudinary not configured',
                    error: 'Missing Cloudinary credentials'
                });
            }
            
            try {
                // Handle both with and without data URL prefix
                let base64Data = imageBase64;
                if (!imageBase64.startsWith('data:')) {
                    base64Data = `data:image/jpeg;base64,${imageBase64}`;
                }
                
                console.log('Uploading to Cloudinary...');
                console.log('Cloud name:', process.env.CLOUDINARY_CLOUD_NAME);
                
                const uploadResult = await cloudinary.uploader.upload(base64Data, {
                    folder: 'sales-visits',
                    resource_type: 'auto'
                });
                
                console.log('Cloudinary upload SUCCESS:', uploadResult.secure_url);
                visitData.imageUrl = uploadResult.secure_url;
                visitData.imagePublicId = uploadResult.public_id;
            } catch (uploadError) {
                console.error('Cloudinary base64 upload FAILED:', uploadError);
                console.error('Error details:', JSON.stringify(uploadError, null, 2));
                // Return error so frontend knows image upload failed
                return res.status(400).json({
                    success: false,
                    message: 'Image upload to Cloudinary failed',
                    error: uploadError.message || 'Unknown Cloudinary error',
                    details: uploadError.http_code || uploadError.error
                });
            }
        } else {
            console.log('WARNING: No image provided in request');
        }

        const visit = await SalesVisit.create(visitData);
        console.log('Visit created:', visit._id, 'Image:', visitData.imageUrl || 'NONE');

        // Populate for response
        const populatedVisit = await SalesVisit.findById(visit._id)
            .populate('salesPerson', 'name username email');

        res.status(201).json({
            success: true,
            message: 'Sales visit recorded successfully',
            data: populatedVisit
        });
    } catch (error) {
        console.error('Create sales visit error:', error);
        
        // If there was an uploaded image and creation failed, delete it
        if (req.file && req.file.filename) {
            await deleteImage(req.file.filename);
        }

        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Delete sales visit
// @route   DELETE /api/sales-visits/:id
// @access  Private (admin or owner)
exports.deleteSalesVisit = async (req, res) => {
    try {
        const visit = await SalesVisit.findById(req.params.id);

        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Sales visit not found'
            });
        }

        // Check access - only admin or owner can delete
        if (req.user.role !== 'admin' && visit.salesPerson.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only admin or owner can delete.'
            });
        }

        // Delete image from Cloudinary if exists
        if (visit.imagePublicId) {
            await deleteImage(visit.imagePublicId);
        }

        await visit.deleteOne();

        res.status(200).json({
            success: true,
            message: 'Sales visit deleted successfully'
        });
    } catch (error) {
        console.error('Delete sales visit error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get sales visits summary (for dashboard)
// @route   GET /api/sales-visits/summary
// @access  Private
exports.getVisitsSummary = async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const filter = {};
        if (req.user.role !== 'admin') {
            filter.salesPerson = req.user.id;
        }

        const [totalVisits, todayVisits, recentVisits] = await Promise.all([
            SalesVisit.countDocuments(filter),
            SalesVisit.countDocuments({ ...filter, date: today }),
            SalesVisit.find(filter)
                .sort({ createdAt: -1 })
                .limit(5)
                .select('companyName location date time imageUrl')
                .lean()
        ]);

        res.status(200).json({
            success: true,
            data: {
                totalVisits,
                todayVisits,
                recentVisits
            }
        });
    } catch (error) {
        console.error('Get visits summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};
