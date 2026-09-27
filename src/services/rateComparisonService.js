/**
 * Rate Comparison domain service — comparison analysis and workflow rules,
 * kept out of the controller so they stay testable and reusable.
 *
 * A comparison holds items[] and, per vendor quotation, lines[] quoting those
 * items (see models/RateComparison.js). Comparisons stored before multi-item
 * support have neither; `toItemView` presents them in the same shape so every
 * reader — validation, summary, API responses, the UI and the PDF — handles one
 * structure. Nothing is written back until the comparison is next saved.
 */
const mongoose = require('mongoose');

const MIN_QUOTATIONS_TO_SUBMIT = 2;

const { ObjectId } = mongoose.Types;
const text = (v) => String(v ?? '').trim();
const isObjectIdString = (v) => /^[a-f0-9]{24}$/i.test(text(v));
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc || {});

const hasItems = (rc) => Array.isArray(rc.items) && rc.items.length > 0;

/**
 * Present a comparison — stored in either shape — as items[] plus a lines[]
 * array on every quotation. A legacy single-material comparison becomes one
 * item whose id is the comparison's own id, so it stays stable between reads.
 */
const toItemView = (doc) => {
    const rc = plain(doc);
    if (hasItems(rc)) {
        return { ...rc, quotations: (rc.quotations || []).map((q) => ({ ...q, lines: q.lines || [] })) };
    }

    const items = rc.materialName || rc.requiredQuantity != null
        ? [{ _id: rc._id, itemName: rc.materialName, requiredQuantity: rc.requiredQuantity, unit: rc.unit }]
        : [];
    const quotations = (rc.quotations || []).map((q) => ({
        ...q,
        lines: items.length && (Number(q.quotedRate) > 0 || q.deliveryTime || q.paymentTerms)
            ? [{
                item: items[0]._id,
                itemName: items[0].itemName,
                quotedRate: q.quotedRate,
                taxPercent: q.taxPercent,
                deliveryTime: q.deliveryTime,
                paymentTerms: q.paymentTerms,
                baseAmount: q.baseAmount,
                taxAmount: q.taxAmount,
                totalAmount: q.totalAmount,
            }]
            : [],
    }));
    return { ...rc, items, quotations };
};

/**
 * Turn a create / update request into items[] and quotations[] with lines.
 *
 * Accepts the multi-item payload:
 *   items:      [{ key, itemName, requiredQuantity, unit }]
 *   quotations: [{ _id, vendor, isSelected, lines: [{ item: <item key>, quotedRate, taxPercent, deliveryTime, paymentTerms }] }]
 * where an item's `key` is its _id for an existing item, or any client-side id
 * for a new one; lines reference items by that key.
 *
 * Also accepts the single-material payload older app builds send
 * (materialName / requiredQuantity / unit, quotations[].quotedRate ...).
 *
 * @returns {{ touched: false } | { touched: true, items, quotations } | { error: string }}
 */
const normaliseSubmission = (body = {}, existing = null, vendorLookup = {}) => {
    const current = existing ? toItemView(existing) : { items: [], quotations: [] };
    const legacyFields = ['materialName', 'requiredQuantity', 'unit'].some((f) => body[f] !== undefined);
    const quotesWithoutLines = Array.isArray(body.quotations) && body.quotations.some((q) => q && q.vendor && !Array.isArray(q.lines));

    if (!Array.isArray(body.items) && body.quotations === undefined && !legacyFields) {
        return { touched: false };
    }

    // A single-material payload cannot describe a comparison of several items;
    // applying it would silently drop every item but one.
    if (!Array.isArray(body.items) && current.items.length > 1 && (legacyFields || quotesWithoutLines)) {
        return { error: 'This comparison has several items. Refresh the page (or update the app) and edit it again.' };
    }

    // --- Items ---------------------------------------------------------------
    let rawItems;
    if (Array.isArray(body.items)) {
        rawItems = body.items;
    } else if (legacyFields) {
        const base = current.items[0] || {};
        rawItems = [{
            key: base._id,
            itemName: body.materialName !== undefined ? body.materialName : base.itemName,
            requiredQuantity: body.requiredQuantity !== undefined ? body.requiredQuantity : base.requiredQuantity,
            unit: body.unit !== undefined ? body.unit : base.unit,
        }];
    } else {
        rawItems = current.items.map((it) => ({ ...it, key: it._id }));
    }

    const keyToId = new Map();
    const items = rawItems
        .filter((it) => it && (text(it.itemName) || text(it.requiredQuantity)))
        .map((it) => {
            const key = text(it.key ?? it._id);
            const reuse = isObjectIdString(key) && !keyToId.has(key);
            const _id = reuse ? new ObjectId(key) : new ObjectId();
            // An item sent without a key is still addressable by its new id
            const ref = key || String(_id);
            if (!keyToId.has(ref)) keyToId.set(ref, _id);
            return {
                _id,
                itemName: text(it.itemName),
                requiredQuantity: Number(it.requiredQuantity) || 0,
                unit: text(it.unit),
            };
        });

    // --- Quotations ------------------------------------------------------------
    const rawQuotes = body.quotations !== undefined
        ? (Array.isArray(body.quotations) ? body.quotations : [])
        : current.quotations;

    const quotations = rawQuotes
        .filter((q) => q && q.vendor)
        .map((q) => {
            const vendor = text(q.vendor?._id ?? q.vendor);

            let rawLines = [];
            if (Array.isArray(q.lines)) {
                rawLines = q.lines;
            } else if (items.length === 1) {
                // Single-material quotation: the quote applies to the one item
                rawLines = [{ ...q, _id: undefined, item: [...keyToId.keys()][0] }];
            }

            const seenItems = new Set();
            const lines = rawLines
                .map((l) => {
                    const key = text(l?.item?._id ?? l?.item ?? l?.itemKey);
                    const item = keyToId.get(key);
                    return item && {
                        item,
                        quotedRate: Number(l.quotedRate) || 0,
                        taxPercent: Number(l.taxPercent) || 0,
                        deliveryTime: text(l.deliveryTime),
                        paymentTerms: text(l.paymentTerms),
                    };
                })
                // A row with nothing entered is simply "not quoted"
                .filter((l) => l && (l.quotedRate > 0 || l.deliveryTime || l.paymentTerms))
                .filter((l) => {
                    const k = String(l.item);
                    if (seenItems.has(k)) return false;
                    seenItems.add(k);
                    return true;
                });

            return {
                _id: isObjectIdString(q._id) ? q._id : undefined,
                vendor,
                vendorName: text(q.vendorName) || vendorLookup[vendor] || '',
                lines,
                vendorRemarks: text(q.vendorRemarks),
                purchaseRemarks: text(q.purchaseRemarks),
                isSelected: !!q.isSelected,
            };
        });

    return { touched: true, items, quotations };
};

/**
 * Validate a comparison.
 * @param {Array} items
 * @param {Array} quotations each with lines[]
 * @param {boolean} forSubmission stricter checks when submitting to the Director
 * @returns {string[]} problems
 */
const validateComparison = (items, quotations, forSubmission = false) => {
    const problems = [];

    if (!items.length) problems.push('Add at least one item to compare');

    const seenItems = new Set();
    items.forEach((it, i) => {
        const name = text(it.itemName);
        const label = name || `Item ${i + 1}`;
        if (!name) problems.push(`Item ${i + 1} needs a material name`);
        if (!(Number(it.requiredQuantity) > 0)) problems.push(`${label} needs a required quantity greater than zero`);
        const key = `${name.toLowerCase()}|${text(it.unit).toLowerCase()}`;
        if (name && seenItems.has(key)) problems.push(`${label} is listed more than once`);
        seenItems.add(key);
    });

    const nameOf = new Map(items.map((it) => [String(it._id), text(it.itemName)]));

    quotations.forEach((q, i) => {
        const who = q.vendorName || `Quotation ${i + 1}`;
        if (!q.vendorName) problems.push(`Quotation ${i + 1} is missing a vendor`);
        const lines = q.lines || [];
        if (!lines.length) problems.push(`${who} has no rates entered — enter at least one rate or remove the vendor`);
        lines.forEach((l) => {
            if (!(Number(l.quotedRate) > 0)) {
                problems.push(`${who} needs a rate greater than zero for ${nameOf.get(String(l.item)) || 'an item'}`);
            }
        });
    });

    // The same vendor twice in one comparison is almost always a mistake
    const seen = new Set();
    quotations.forEach((q) => {
        const key = String(q.vendor?._id || q.vendor);
        if (seen.has(key)) problems.push(`${q.vendorName} appears more than once in this comparison`);
        seen.add(key);
    });

    if (forSubmission) {
        if (quotations.length < MIN_QUOTATIONS_TO_SUBMIT) {
            problems.push(`Add at least ${MIN_QUOTATIONS_TO_SUBMIT} vendor quotations before sending this to the Director`);
        }
        const selected = quotations.filter((q) => q.isSelected);
        if (!selected.length) problems.push('Select the vendor you are recommending before submitting');
        if (selected.length > 1) problems.push('Only one vendor can be recommended');

        // The purchase order is raised with the recommended vendor for every
        // item, so that vendor must have quoted all of them.
        if (selected.length === 1) {
            const quoted = new Set((selected[0].lines || []).filter((l) => Number(l.quotedRate) > 0).map((l) => String(l.item)));
            const missing = items.filter((it) => !quoted.has(String(it._id))).map((it) => it.itemName);
            if (missing.length) {
                problems.push(`${selected[0].vendorName} is recommended but has not quoted ${missing.join(', ')}. The recommended vendor must quote every item.`);
            }
        }
    }

    return problems;
};

// "7 days" / "2 weeks" -> a comparable number of days, best effort
const daysOf = (value) => {
    const m = String(value || '').match(/(\d+)\s*(day|week|month)/i);
    if (!m) return null;
    const n = Number(m[1]);
    return { day: n, week: n * 7, month: n * 30 }[m[2].toLowerCase()];
};

/**
 * Derive the comparison summary the Director needs at a glance: which vendor
 * is cheapest overall, which is fastest, how the recommendation compares to the
 * lowest, and — per item — which vendor quoted it lowest.
 *
 * Vendor totals are only comparable between vendors that quoted every item, so
 * "lowest" is chosen among those; if none quoted everything, among all vendors.
 */
const buildComparisonSummary = (comparison) => {
    const { items, quotations } = toItemView(comparison);
    const quotedLines = (q) => (q.lines || []).filter((l) => Number(l.quotedRate) > 0);
    const quotes = quotations.filter((q) => q.totalAmount > 0);
    if (!quotes.length) return null;

    const coversAll = (q) => {
        const ids = new Set(quotedLines(q).map((l) => String(l.item)));
        return items.every((it) => ids.has(String(it._id)));
    };
    const complete = quotes.filter(coversAll);
    const pool = complete.length ? complete : quotes;

    const sortedByAmount = [...pool].sort((a, b) => a.totalAmount - b.totalAmount);
    const lowest = sortedByAmount[0];
    const highest = sortedByAmount[sortedByAmount.length - 1];
    const selected = quotes.find((q) => q.isSelected) || null;

    // A vendor is as fast as its slowest item
    const withDays = quotes
        .map((q) => {
            const days = quotedLines(q).map((l) => daysOf(l.deliveryTime)).filter((d) => d != null);
            return { q, days: days.length ? Math.max(...days) : null };
        })
        .filter((x) => x.days != null);
    const fastest = withDays.length ? withDays.sort((a, b) => a.days - b.days)[0].q : null;

    const itemSummaries = items.map((it) => {
        const offers = quotations
            .map((q) => ({ q, line: quotedLines(q).find((l) => String(l.item) === String(it._id)) }))
            .filter((x) => x.line);
        const best = offers.length ? [...offers].sort((a, b) => a.line.totalAmount - b.line.totalAmount)[0] : null;
        return {
            item: it._id,
            itemName: it.itemName,
            requiredQuantity: it.requiredQuantity,
            unit: it.unit,
            quoteCount: offers.length,
            lowest: best ? {
                quotation: best.q._id,
                vendorName: best.q.vendorName,
                quotedRate: best.line.quotedRate,
                totalAmount: best.line.totalAmount,
            } : null,
        };
    });

    const selectedIsComparable = selected && (coversAll(selected) || !complete.length);

    return {
        vendorCount: quotes.length,
        itemCount: items.length,
        completeVendorCount: complete.length,
        lowest: { quotation: lowest._id, vendorName: lowest.vendorName, totalAmount: lowest.totalAmount },
        highest: { vendorName: highest.vendorName, totalAmount: highest.totalAmount },
        spread: +(highest.totalAmount - lowest.totalAmount).toFixed(2),
        fastest: fastest ? { vendorName: fastest.vendorName, deliveryTime: fastest.deliveryTime } : null,
        selected: selected ? {
            vendorName: selected.vendorName,
            totalAmount: selected.totalAmount,
            quotesAllItems: coversAll(selected),
            isLowest: !!selectedIsComparable && selected.totalAmount <= lowest.totalAmount,
            // Positive means the recommendation costs more than the cheapest quote
            premiumOverLowest: +(selected.totalAmount - lowest.totalAmount).toFixed(2),
        } : null,
        items: itemSummaries,
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
    toItemView,
    normaliseSubmission,
    validateComparison,
    buildComparisonSummary,
    allowedTransitions,
    canEdit,
};
