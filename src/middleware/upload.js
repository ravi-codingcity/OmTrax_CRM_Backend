/**
 * Multipart upload handling for KYC documents.
 *
 * Files are held in memory and streamed straight to Cloudinary by the service —
 * nothing is written to disk. The app's global express.json() 1mb limit does not
 * apply to multipart bodies, so the limits configured here are the ones that
 * matter for uploads.
 *
 * Multer enforces a first pass (size ceiling, obvious mime rejects) and the
 * request is then re-validated in kycValidator, which also checks the file
 * extension. A caller hitting the API directly cannot get past both.
 */

const multer = require('multer');
const path = require('path');
const {
    MAX_FILE_BYTES, MAX_FILE_MB, MAX_FILES,
    ALLOWED_TYPES, ALLOWED_EXTENSIONS, ALLOWED_LABEL,
    allowedTypesFor, allowedExtensionsFor, allowedLabelFor,
} = require('../constants/kycConstants');

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(1).toLowerCase();
    // Accepted formats depend on the slot: the two template documents also take
    // .doc / .docx, everything else keeps the original rules.
    const types = allowedTypesFor(file.fieldname);
    const byMime = types[file.mimetype];

    // Both the declared mime type and the real extension have to be acceptable.
    if (byMime && allowedExtensionsFor(file.fieldname).includes(ext) && byMime.ext.includes(ext)) {
        return cb(null, true);
    }
    cb(new Error(`"${file.originalname}" is not an accepted format. Upload ${allowedLabelFor(file.fieldname)} only.`));
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    fileFilter,
});

/**
 * Accept any combination of the KYC document slots. `.any()` keeps the public
 * form flexible — a vendor may send some documents and not others — while the
 * validator maps each fieldname onto a known docType and rejects the rest.
 */
const kycDocuments = upload.any();

/**
 * Turn multer's own errors into the app's standard JSON envelope, so an
 * oversized file reads as a clear message rather than a 500.
 */
const handleUploadErrors = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const message = {
            LIMIT_FILE_SIZE: `Each document must be under ${MAX_FILE_MB} MB.`,
            LIMIT_FILE_COUNT: `Upload at most ${MAX_FILES} documents.`,
            LIMIT_UNEXPECTED_FILE: 'Unexpected file field.',
        }[err.code] || 'File upload failed.';
        return res.status(400).json({ success: false, message });
    }
    if (err && /not an accepted format/.test(err.message)) {
        return res.status(400).json({ success: false, message: err.message });
    }
    return next(err);
};

module.exports = { upload, kycDocuments, handleUploadErrors, MAX_FILE_BYTES, MAX_FILE_MB, MAX_FILES };
