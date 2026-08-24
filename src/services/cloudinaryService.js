/**
 * Cloudinary service — the only place in the codebase that talks to Cloudinary.
 *
 * Credentials live in the backend .env and never reach the frontend. Every
 * upload goes through the API (the browser never gets an upload signature), and
 * every asset is stored as `type: 'authenticated'`, which means the raw
 * Cloudinary URL is NOT publicly fetchable. Purchase/Finance get a short-lived
 * signed URL only after the API has checked their permissions.
 */

const cloudinary = require('cloudinary').v2;
const path = require('path');
const { SIGNED_URL_TTL_SECONDS } = require('../constants/kycConstants');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const KYC_FOLDER = process.env.CLOUDINARY_KYC_FOLDER || 'omtrax/kyc';

const isConfigured = !!(CLOUD_NAME && API_KEY && API_SECRET);

// Ceiling for a single upload. Without this a stalled connection leaves the
// whole KYC submission hanging, which is what left the vendor's form stuck on
// "submitting" with no way forward.
const UPLOAD_TIMEOUT_MS = Number(process.env.CLOUDINARY_TIMEOUT_MS || 45000);

if (isConfigured) {
    cloudinary.config({
        cloud_name: CLOUD_NAME,
        api_key: API_KEY,
        api_secret: API_SECRET,
        secure: true,
    });
} else {
    console.warn(
        '[cloudinary] Not configured — KYC document uploads will be rejected. ' +
        'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in .env.'
    );
}

const NOT_CONFIGURED_MSG =
    'Document storage is not configured. Ask an administrator to set the Cloudinary credentials.';

/**
 * Cloudinary sorts assets into three resource types and the correct one has to
 * be supplied on every later read, so it is stored alongside the public id.
 *   - jpg/jpeg  -> image
 *   - pdf       -> image (Cloudinary treats PDFs as renderable images)
 *   - xls/xlsx  -> raw
 */
const resourceTypeFor = (mimetype, originalName = '') => {
    const ext = path.extname(originalName).slice(1).toLowerCase();
    if (['xls', 'xlsx'].includes(ext)) return 'raw';
    if (mimetype === 'application/pdf' || ext === 'pdf') return 'image';
    if (mimetype && mimetype.startsWith('image/')) return 'image';
    return 'raw';
};

/**
 * Upload one in-memory buffer (from multer) to Cloudinary.
 *
 * @param {Buffer} buffer
 * @param {Object} opts { folder, publicId, originalName, mimetype }
 * @returns {Promise<Object>} { url, publicId, format, bytes, resourceType }
 */
const uploadBuffer = (buffer, { folder = KYC_FOLDER, publicId, originalName, mimetype } = {}) =>
    new Promise((resolve, reject) => {
        if (!isConfigured) return reject(new Error(NOT_CONFIGURED_MSG));

        const resourceType = resourceTypeFor(mimetype, originalName);

        let settled = false;
        const finish = (fn) => (arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };
        const done = finish(resolve);
        const failed = finish(reject);

        const timer = setTimeout(
            () => failed(new Error(`Upload timed out after ${Math.round(UPLOAD_TIMEOUT_MS / 1000)}s`)),
            UPLOAD_TIMEOUT_MS + 2000
        );

        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                public_id: publicId,
                resource_type: resourceType,
                // Not publicly reachable — reads require a signed URL.
                type: 'authenticated',
                use_filename: !publicId,
                unique_filename: true,
                overwrite: false,
                timeout: UPLOAD_TIMEOUT_MS,
                context: originalName ? { original_name: originalName } : undefined,
            },
            (err, result) => {
                if (err) return failed(new Error(err.message || 'Upload failed'));
                if (!result) return failed(new Error('Upload returned no result'));
                done({
                    url: result.secure_url,
                    publicId: result.public_id,
                    format: result.format || path.extname(originalName || '').slice(1).toLowerCase(),
                    bytes: result.bytes,
                    resourceType,
                });
            }
        );

        stream.on('error', (err) => failed(new Error(err.message || 'Upload stream failed')));
        stream.end(buffer);
    });

/**
 * Build a short-lived signed URL for an authenticated asset.
 *
 * @param {Object} doc      the stored document sub-document
 * @param {Object} opts     { download: true } adds fl_attachment so the browser
 *                          saves the file instead of rendering it
 * @returns {string|null}
 */
const signedUrlFor = (doc, { download = false } = {}) => {
    if (!isConfigured || !doc?.publicId) return null;

    const resourceType = doc.resourceType || resourceTypeFor(doc.format, doc.originalName);
    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;

    const options = {
        resource_type: resourceType,
        type: 'authenticated',
        sign_url: true,
        secure: true,
        expires_at: expiresAt,
    };

    if (download) {
        // Ask Cloudinary to serve it as a download, preserving the original name
        const base = (doc.originalName || 'document').replace(/\.[^.]+$/, '');
        options.flags = `attachment:${base.replace(/[^\w\-]/g, '_')}`;
    }

    return cloudinary.url(doc.publicId, options);
};

/**
 * Remove an asset. Best-effort — a failure here must never break the request
 * that triggered it.
 */
const destroy = async (doc) => {
    if (!isConfigured || !doc?.publicId) return false;
    try {
        await cloudinary.uploader.destroy(doc.publicId, {
            resource_type: doc.resourceType || 'image',
            type: 'authenticated',
        });
        return true;
    } catch (err) {
        console.error('[cloudinary] destroy failed:', err.message);
        return false;
    }
};

module.exports = {
    cloudinary,
    UPLOAD_TIMEOUT_MS,
    uploadBuffer,
    signedUrlFor,
    destroy,
    resourceTypeFor,
    isConfigured,
    KYC_FOLDER,
    NOT_CONFIGURED_MSG,
};
