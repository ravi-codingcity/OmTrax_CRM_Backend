// Utility helper functions

/**
 * Paginate results
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @returns {Object} - Skip and limit values
 */
exports.paginate = (page = 1, limit = 10) => {
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;
    
    return { skip, limit: limitNum, page: pageNum };
};

/**
 * Create pagination response
 * @param {number} total - Total records
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} - Pagination metadata
 */
exports.paginationResponse = (total, page, limit) => {
    const totalPages = Math.ceil(total / limit);
    
    return {
        currentPage: page,
        totalPages,
        totalRecords: total,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null
    };
};

/**
 * Build date range filter
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {Object|null} - MongoDB date filter
 */
exports.buildDateFilter = (startDate, endDate) => {
    if (!startDate && !endDate) return null;
    
    const filter = {};
    if (startDate) filter.$gte = new Date(startDate);
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.$lte = end;
    }
    
    return filter;
};

/**
 * Format date to YYYY-MM-DD
 * @param {Date} date - Date object
 * @returns {string} - Formatted date string
 */
exports.formatDate = (date) => {
    if (!date) return null;
    const d = new Date(date);
    return d.toISOString().split('T')[0];
};

/**
 * Get start and end of day
 * @param {Date} date - Date object
 * @returns {Object} - Start and end of day
 */
exports.getDayRange = (date = new Date()) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
};

/**
 * Get start and end of month
 * @param {Date} date - Date object
 * @returns {Object} - Start and end of month
 */
exports.getMonthRange = (date = new Date()) => {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    
    return { start, end };
};

/**
 * Clean empty fields from object
 * @param {Object} obj - Object to clean
 * @returns {Object} - Cleaned object
 */
exports.cleanObject = (obj) => {
    const cleaned = {};
    Object.keys(obj).forEach(key => {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
            cleaned[key] = obj[key];
        }
    });
    return cleaned;
};

/**
 * Generate random string
 * @param {number} length - Length of string
 * @returns {string} - Random string
 */
exports.generateRandomString = (length = 10) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};
