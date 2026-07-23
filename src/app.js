const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const salesRoutes = require('./routes/salesRoutes');
const followUpRoutes = require('./routes/followUpRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const branchRoutes = require('./routes/branchRoutes');
const businessRoutes = require('./routes/businessRoutes');
const recruitmentRoutes = require('./routes/recruitmentRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');

// Initialize express app
const app = express();

// ============================================
// MIDDLEWARE
// ============================================

// CORS - Allow all origins (simple configuration)
app.use(cors({
    origin: true, // Allow all origins
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    // 'x-auth-access-key' is the URL-based auth header sent by the Sign Up /
    // Reset Password pages — without it the browser's preflight for those
    // requests fails with a CORS error.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-access-key'],
    // Let the browser read the export row count from the download response
    exposedHeaders: ['X-Total-Records']
}));

// Body parser middleware. The old 50mb ceiling existed only for base64 image
// uploads (Sales Visit); 1mb is ample for JSON payloads and limits abuse.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging in development
if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// ============================================
// ROUTES
// ============================================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'OmTrax CRM API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/follow-ups', followUpRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/purchase', purchaseRoutes);

// ============================================
// ERROR HANDLING
// ============================================

// Handle 404 - Route not found
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.originalUrl} not found`
    });
});

// Global error handler
app.use(errorHandler);

module.exports = app;
