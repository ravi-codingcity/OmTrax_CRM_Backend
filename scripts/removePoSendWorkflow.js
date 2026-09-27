/**
 * One-off migration: retire the "send PO through the CRM" workflow.
 *
 * Purchase Orders are now downloaded, printed on letterhead and sent by hand, so
 * the fields the old workflow left behind are cleaned up:
 *
 *   - POs in status 'sent' or 'acknowledged'  ->  'generated'
 *   - the sentAt / sentTo / sentMethod / sentBy / sentByName fields are removed
 *
 * Nothing else is touched. No document is deleted: the PO itself, its items,
 * amounts, terms, creator and activity history (including past 'sent' /
 * 'acknowledged' entries) stay exactly as they are, and existing 'po_sent'
 * notifications are kept as history.
 *
 * Nothing is written unless --apply is passed. Before writing, every affected
 * document is saved in full to a JSON backup next to this script.
 *
 *   node scripts/removePoSendWorkflow.js           # dry run: report only
 *   node scripts/removePoSendWorkflow.js --apply   # back up, then migrate
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const SENT_FIELDS = ['sentAt', 'sentTo', 'sentMethod', 'sentBy', 'sentByName'];
const LEGACY_STATUSES = ['sent', 'acknowledged'];

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const orders = db.collection('purchaseorders');

    const statusFilter = { status: { $in: LEGACY_STATUSES } };
    const fieldFilter = { $or: SENT_FIELDS.map((f) => ({ [f]: { $exists: true } })) };

    const affectedOrders = await orders.find({ $or: [statusFilter, fieldFilter] }).toArray();

    console.log(`Database: ${db.databaseName}`);
    console.log(`POs with a legacy status : ${affectedOrders.filter((o) => LEGACY_STATUSES.includes(o.status)).length}`);
    console.log(`POs with sent* fields    : ${affectedOrders.filter((o) => SENT_FIELDS.some((f) => f in o)).length}`);
    affectedOrders.forEach((o) => console.log(`   ${o.poNumber}  status=${o.status}  active=${o.isActive}`));

    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply to migrate.');
        await mongoose.disconnect();
        return;
    }
    if (!affectedOrders.length) {
        console.log('\nNothing to migrate.');
        await mongoose.disconnect();
        return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(__dirname, `backup-po-send-workflow-${db.databaseName}-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({ purchaseorders: affectedOrders }, null, 2));
    console.log(`\nBackup written: ${backupFile}`);

    const statusResult = await orders.updateMany(statusFilter, { $set: { status: 'generated' } });
    const fieldResult = await orders.updateMany(fieldFilter, { $unset: Object.fromEntries(SENT_FIELDS.map((f) => [f, ''])) });

    console.log(`Status -> generated      : ${statusResult.modifiedCount}`);
    console.log(`sent* fields removed     : ${fieldResult.modifiedCount}`);
    await mongoose.disconnect();
})().catch(async (err) => {
    console.error('Migration failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
