/**
 * Rate Comparison domain service — comparison analysis and workflow rules,
 * kept out of the controller so they stay testable and reusable.
 */

const MIN_QUOTATIONS_TO_SUBMIT = 2;

/**
 * Normalise incoming quotation rows. Amounts are deliberately NOT computed here
 * — the model's pre-save hook owns that, so there is one source of truth.
 */
const normaliseQuotations = (rows, vendorLookup = {}) =>
    (Array.isArray(rows) ? rows : [])
        .filter((q) => q && q.vendor)
        .map((q) => ({
            _id: q._id || undefined,
            vendor: q.vendor,
            vendorName: (q.vendorName || vendorLookup[String(q.vendor)] || '').trim(),
            quotedRate: Number(q.quotedRate) || 0,
            taxPercent: Number(q.taxPercent) || 0,
            deliveryCharges: Number(q.deliveryCharges) || 0,
            deliveryTime: (q.deliveryTime || '').trim(),
            paymentTerms: (q.paymentTerms || '').trim(),
            vendorRemarks: (q.vendorRemarks || '').trim(),
            purchaseRemarks: (q.purchaseRemarks || '').trim(),
            isSelected: !!q.isSelected,
        }));

/**
 * Validate a comparison before it is saved.
 * @param {Object} payload
 * @param {boolean} forSubmission stricter checks when submitting to the Director
 * @returns {string[]} problems
 */
const validateComparison = (payload, quotations, forSubmission = false) => {
    const problems = [];

    if (!String(payload.materialName || '').trim()) problems.push('Material name is required');
    const qty = Number(payload.requiredQuantity);
    if (!qty || qty <= 0) problems.push('Required quantity must be greater than zero');

    quotations.forEach((q, i) => {
        if (!q.vendorName) problems.push(`Quotation ${i + 1} is missing a vendor`);
        if (!q.quotedRate || q.quotedRate <= 0) problems.push(`${q.vendorName || `Quotation ${i + 1}`} needs a rate greater than zero`);
    });

    // The same vendor twice in one comparison is almost always a mistake
    const seen = new Set();
    quotations.forEach((q) => {
        const key = String(q.vendor);
        if (seen.has(key)) problems.push(`${q.vendorName} appears more than once in this comparison`);
        seen.add(key);
    });

    if (forSubmission) {
        if (quotations.length < MIN_QUOTATIONS_TO_SUBMIT) {
            problems.push(`Add at least ${MIN_QUOTATIONS_TO_SUBMIT} vendor quotations before sending this to the Director`);
        }
        if (!quotations.some((q) => q.isSelected)) {
            problems.push('Select the vendor you are recommending before submitting');
        }
        if (quotations.filter((q) => q.isSelected).length > 1) {
            problems.push('Only one vendor can be recommended');
        }
    }

    return problems;
};

/**
 * Derive the comparison summary the Director needs at a glance: which quote is
 * cheapest, which is fastest, and how the recommendation compares to the lowest.
 */
const buildComparisonSummary = (comparison) => {
    const quotes = (comparison.quotations || []).filter((q) => q.totalAmount > 0);
    if (!quotes.length) return null;

    const sortedByAmount = [...quotes].sort((a, b) => a.totalAmount - b.totalAmount);
    const lowest = sortedByAmount[0];
    const highest = sortedByAmount[sortedByAmount.length - 1];
    const selected = quotes.find((q) => q.isSelected) || null;

    // "7 days" / "2 weeks" -> a comparable number of days, best effort
    const daysOf = (text) => {
        const m = String(text || '').match(/(\d+)\s*(day|week|month)/i);
        if (!m) return null;
        const n = Number(m[1]);
        return { day: n, week: n * 7, month: n * 30 }[m[2].toLowerCase()];
    };
    const withDays = quotes.map((q) => ({ q, days: daysOf(q.deliveryTime) })).filter((x) => x.days != null);
    const fastest = withDays.length ? withDays.sort((a, b) => a.days - b.days)[0].q : null;

    return {
        vendorCount: quotes.length,
        lowest: { vendorName: lowest.vendorName, totalAmount: lowest.totalAmount },
        highest: { vendorName: highest.vendorName, totalAmount: highest.totalAmount },
        spread: +(highest.totalAmount - lowest.totalAmount).toFixed(2),
        fastest: fastest ? { vendorName: fastest.vendorName, deliveryTime: fastest.deliveryTime } : null,
        selected: selected ? {
            vendorName: selected.vendorName,
            totalAmount: selected.totalAmount,
            isLowest: String(selected._id) === String(lowest._id),
            // Positive means the recommendation costs more than the cheapest quote
            premiumOverLowest: +(selected.totalAmount - lowest.totalAmount).toFixed(2),
        } : null,
    };
};

/**
 * Which workflow transitions are legal from the current status.
 */
const allowedTransitions = (status) => ({
    draft: ['pending_approval', 'cancelled'],
    sent_back: ['pending_approval', 'cancelled'],
    rejected: ['cancelled'],
    pending_approval: ['approved', 'rejected', 'sent_back'],
    approved: ['cancelled'],
    cancelled: [],
}[status] || []);

const canEdit = (comparison) => ['draft', 'sent_back'].includes(comparison.status);

module.exports = {
    MIN_QUOTATIONS_TO_SUBMIT,
    normaliseQuotations,
    validateComparison,
    buildComparisonSummary,
    allowedTransitions,
    canEdit,
};
