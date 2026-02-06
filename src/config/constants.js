module.exports = {
    // JWT Configuration
    jwtSecret: process.env.JWT_SECRET || 'fallback_secret_key',
    jwtExpire: process.env.JWT_EXPIRE || '7d',
    
    // Server Configuration
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // CORS Configuration
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    
    // Pagination defaults
    defaultPageSize: 10,
    maxPageSize: 100,
    
    // User roles
    roles: {
        ADMIN: 'admin',
        SALESPERSON: 'salesperson',
        MANAGER: 'manager'
    },
    
    // Query status options
    queryStatus: {
        NEW: 'new',
        IN_PROGRESS: 'in_progress',
        FOLLOW_UP: 'follow_up',
        CONVERTED: 'converted',
        CLOSED: 'closed',
        NOT_INTERESTED: 'not_interested'
    },
    
    // Notification types
    notificationTypes: {
        FOLLOWUP: 'followup',
        REMINDER: 'reminder',
        NEW_ENTRY: 'new_entry'
    }
};
