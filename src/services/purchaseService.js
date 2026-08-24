const { isAdminLevel } = require('../utils/department');

// Purchase domain services: inventory math and business-rule validation.
// Keeping this logic here (rather than in controllers) makes it reusable and
// easy to unit test as the module grows.

// Net quantity currently out on jobs = dispatched − returned.
const netDispatched = (entry) => (entry.totalDispatched || 0) - (entry.totalReturned || 0);

// --- Location-based receipt / stock permissions ---------------------------

const LOCATION_ROLES = ['warehouse_manager', 'branch_manager'];

const isLocationManager = (user) => !!user && LOCATION_ROLES.includes(user.role);

// A location manager is responsible for the storage location whose name matches
// their `branch` (case-insensitive). This is how a location is "assigned".
const matchesLocation = (user, locationName) => {
    if (!user || !locationName) return false;
    return (user.branch || '').trim().toLowerCase() === String(locationName).trim().toLowerCase();
};

// Who may mark a *pending* material received / not received:
// the admin, or the location manager responsible for that storage location.
const canReceive = (entry, user) => {
    if (!user) return false;
    if (isAdminLevel(user)) return true;
    return isLocationManager(user) && matchesLocation(user, entry?.storageLocation);
};

// Who may record dispatches/returns: same as receive, but only *after* the
// material has actually been received into that location.
const canManageStock = (entry, user) => {
    if (!user) return false;
    if (entry?.receiptStatus !== 'received') return false;
    return canReceive(entry, user);
};

// Validate a new dispatch:
//  - the material must have been received first
//  - cannot dispatch more than what is available in stock
//  - a Job Number is mandatory (every dispatch must be traceable to a job)
const validateDispatch = (entry, payload = {}) => {
    if (entry.receiptStatus !== 'received') {
        return { ok: false, message: 'Material must be marked Received before it can be dispatched' };
    }
    const qty = Number(payload.quantity);
    if (!qty || qty <= 0) {
        return { ok: false, message: 'Dispatch quantity must be greater than 0' };
    }
    if (qty > (entry.availableStock || 0)) {
        return { ok: false, message: `Only ${entry.availableStock} unit(s) available in stock` };
    }
    if (!payload.jobNumber || !String(payload.jobNumber).trim()) {
        return { ok: false, message: 'Job Number is required' };
    }
    return { ok: true };
};

// Write access to a purchase record:
//  - CRM Admin can modify anything
//  - other Purchase staff may only modify records they personally created
//    (everyone can still *view* all records across every location)
const canModifyEntry = (entry, user) => {
    if (!user) return false;
    if (isAdminLevel(user)) return true;
    const owner = entry?.createdBy ? String(entry.createdBy._id || entry.createdBy) : '';
    return !!owner && owner === String(user.id);
};

// Validate a return. Cannot return more than what is currently out on jobs.
const validateReturn = (entry, quantity) => {
    if (entry.receiptStatus !== 'received') {
        return { ok: false, message: 'Material must be marked Received before returns can be recorded' };
    }
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

module.exports = {
    netDispatched, validateDispatch, validateReturn, canModifyEntry, buildInventorySummary,
    isLocationManager, matchesLocation, canReceive, canManageStock, LOCATION_ROLES
};
