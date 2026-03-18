const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Verify configuration
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

console.log('=== Cloudinary Configuration ===');
console.log('Cloud name:', cloudName || 'NOT SET');
console.log('API Key:', apiKey ? `${apiKey.substring(0, 4)}...` : 'NOT SET');
console.log('API Secret:', apiSecret ? 'SET (hidden)' : 'NOT SET');

if (!cloudName || !apiKey || !apiSecret) {
    console.error('WARNING: Cloudinary credentials are not fully configured!');
}

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        console.log('Processing file for Cloudinary:', file.originalname, file.mimetype);
        return {
            folder: 'omtrax-crm/sales-visits',
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [
                { width: 1024, height: 1024, crop: 'limit', quality: 'auto:good' }
            ],
            resource_type: 'image'
        };
    }
});

// Multer upload middleware with better error handling
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit for mobile captures
    },
    fileFilter: (req, file, cb) => {
        console.log('Multer fileFilter - File received:', file.originalname, file.mimetype);
        // Accept images only
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Delete image from Cloudinary
const deleteImage = async (publicId) => {
    try {
        if (publicId) {
            await cloudinary.uploader.destroy(publicId);
        }
    } catch (error) {
        console.error('Cloudinary delete error:', error);
    }
};

module.exports = {
    cloudinary,
    upload,
    deleteImage
};
