// Purchase domain services: inventory math and business-rule validation.
// Keeping this logic here (rather than in controllers) makes it reusable and
// easy to unit test as the module grows.

// Net quantity currently out on jobs = dispatched − returned.
const netDispatched = (entry) => (entry.totalDispatched || 0) - (entry.totalReturned || 0);

// Validate a new dispatch:
//  - cannot dispatch more than what is available in stock
//  - a purpose is mandatory
//  - it must be traceable: either a Job Number, or a reason for not having one
const validateDispatch = (entry, payload = {}) => {
    const qty = Number(payload.quantity);
    if (!qty || qty <= 0) {
        return { ok: false, message: 'Dispatch quantity must be greater than 0' };
    }
    if (qty > (entry.availableStock || 0)) {
        return { ok: false, message: `Only ${entry.availableStock} unit(s) available in stock` };
    }
    if (!payload.purpose || !String(payload.purpose).trim()) {
        return { ok: false, message: 'Purpose of dispatch is required' };
    }
    const hasJob = payload.jobNumber && String(payload.jobNumber).trim();
    const hasReason = payload.noJobNumberReason && String(payload.noJobNumberReason).trim();
    if (!hasJob && !hasReason) {
        return { ok: false, message: 'Enter a Job Number, or a reason for dispatching without one' };
    }
    return { ok: true };
};

// Validate a return. Cannot return more than what is currently out on jobs.
const validateReturn = (entry, quantity) => {
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
        return { ok: false, message: 'Return quantity must be greater than 0' };
    }
    const out = netDispatched(entry);
    if (qty > out) {
        return { ok: false, message: `Only ${out} unit(s) are out for return` };
    }
    return { ok: true };
};

// Aggregate a set of purchase entries into a per-item inventory summary.
const buildInventorySummary = (entries) => {
    const byItem = {};
    entries.forEach((e) => {
        const key = (e.itemName || 'Unknown').trim();
        if (!byItem[key]) {
            byItem[key] = {
                itemName: key,
                unit: e.unit || '',
                storageLocations: new Set(),
                totalPurchased: 0,
                totalDispatched: 0,
                totalReturned: 0,
                availableStock: 0,
                entries: 0,
            };
        }
        const row = byItem[key];
        if (e.storageLocation) row.storageLocations.add(e.storageLocation);
        row.totalPurchased += e.quantityPurchased || 0;
        row.totalDispatched += e.totalDispatched || 0;
        row.totalReturned += e.totalReturned || 0;
        row.availableStock += e.availableStock || 0;
        row.entries += 1;
    });
    // Serialise the location Set so it survives JSON transport
    return Object.values(byItem)
        .map((r) => ({ ...r, storageLocations: [...r.storageLocations] }))
        .sort((a, b) => b.totalPurchased - a.totalPurchased);
};

module.exports = { netDispatched, validateDispatch, validateReturn, buildInventorySummary };
