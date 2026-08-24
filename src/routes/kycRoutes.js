const express = require('express');
const router = express.Router();
const kycController = require('../controllers/kycController');
const { kycDocuments, handleUploadErrors } = require('../middleware/upload');
const rateLimit = require('../middleware/rateLimit');

/**
 * PUBLIC routes — deliberately NOT behind `protect`.
 *
 * The vendor filling in a KYC form has no CRM account. Authorisation comes from
 * the 64-hex token in the URL, which maps to exactly one vendor, expires, and
 * stops working once the form is submitted.
 *
 * Both endpoints are rate-limited so the token space cannot be brute-forced and
 * the upload path cannot be abused.
 */

const readLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

router.get('/:token', readLimiter, kycController.getKycForm);

router.post(
    '/:token',
    submitLimiter,
    kycDocuments,          // multipart parsing (memory storage)
    handleUploadErrors,    // turn multer errors into the standard JSON envelope
    kycController.submitKyc
);

module.exports = router;
