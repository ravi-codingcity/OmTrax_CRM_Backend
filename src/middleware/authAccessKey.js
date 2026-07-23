const crypto = require('crypto');

// URL-based authentication for the sensitive auth pages (Sign Up / Reset
// Password).
//
// The secret lives in the page URL, and the frontend forwards it to the API as
// the `x-auth-access-key` header. Enforcing it here — not just in the React
// router — is what makes this a real control: without the key, the endpoint
// cannot be used even by calling the API directly with curl/Postman.
//
// Set AUTH_ACCESS_KEY in the backend .env and VITE_AUTH_ACCESS_KEY in the
// frontend build. They must match.

// Constant-time compare so the key cannot be recovered by timing the response.
const safeEqual = (a = '', b = '') => {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
};

const requireAuthAccessKey = (req, res, next) => {
    const expected = process.env.AUTH_ACCESS_KEY;

    // Fail closed: if the server has no key configured, the protected auth
    // pages are unavailable rather than silently open to everyone.
    if (!expected) {
        console.error('AUTH_ACCESS_KEY is not set — refusing access to protected auth route.');
        return res.status(503).json({
            success: false,
            message: 'Authentication is not configured. Please contact your administrator.'
        });
    }

    const provided = req.headers['x-auth-access-key'] || req.query.key || req.body?.accessKey;

    if (!safeEqual(provided, expected)) {
        // 404 rather than 403: don't confirm that the endpoint exists.
        return res.status(404).json({ success: false, message: 'Not found' });
    }

    // Never let the key leak into the created document
    if (req.body && 'accessKey' in req.body) delete req.body.accessKey;

    next();
};

module.exports = requireAuthAccessKey;
