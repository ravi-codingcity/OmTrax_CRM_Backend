/**
 * Seeds a full set of randomised test data across all three departments so the
 * dashboards, analytics, and workflows have something to show during development.
 *
 * Creates: users (admin, sales, HR, purchase), sales leads, follow-ups, business
 * entries, recruitment requirements, purchase materials with dispatch/return
 * history, and the purchase master data (items, suppliers, locations).
 *
 * SAFETY: refuses to run against any database that is not on localhost. This
 * script writes fabricated leads, job numbers, and users. In a live CRM that
 * data is indistinguishable from real records, soft deletes leave it behind
 * forever, and Business job numbers are unique and immutable — a fake one
 * permanently occupies a real job number. Pass --force only if you truly mean it.
 *
 * USAGE (run from the CRM Backend folder):
 *   node scripts/seedTestData.js                # seed on top of what is there
 *   node scripts/seedTestData.js --clean        # wipe all collections, then seed
 *   node scripts/seedTestData.js --summary      # just report current row counts
 *
 * The admin login is always:  admin / Admin@123
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const User = require('../src/models/User');
const SalesEntry = require('../src/models/SalesEntry');
const FollowUp = require('../src/models/FollowUp');
const Business = require('../src/models/Business');
const RecruitmentEntry = require('../src/models/RecruitmentEntry');
const PurchaseEntry = require('../src/models/PurchaseEntry');
const Item = require('../src/models/Item');
const Supplier = require('../src/models/Supplier');
const StorageLocation = require('../src/models/StorageLocation');
const Notification = require('../src/models/Notification');
const DismissedReminder = require('../src/models/DismissedReminder');

const { MASTER_ITEMS, STORAGE_LOCATIONS } = require('../src/constants/purchaseConstants');

// ---------------------------------------------------------------------------
// Safety guard
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'];

function describeTarget(uri) {
    const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
    const afterAuth = withoutScheme.includes('@')
        ? withoutScheme.slice(withoutScheme.lastIndexOf('@') + 1)
        : withoutScheme;
    const host = afterAuth.split('/')[0].split(',')[0];
    const dbName = (afterAuth.split('/')[1] || '').split('?')[0] || '(default)';
    return { host, hostname: host.split(':')[0], dbName };
}

function guardTarget(uri, force, clean) {
    const { host, hostname, dbName } = describeTarget(uri);
    const isLocal = LOCAL_HOSTS.includes(hostname);
    console.log(`Target : ${host}/${dbName}`);

    // --clean calls deleteMany({}) on every collection. On a shared or production
    // database that destroys the entire business. There is no flag combination
    // that permits it off localhost — not even --force.
    if (clean && !isLocal) {
        console.error(`
Refusing to run: --clean wipes EVERY collection, and ${hostname} is not local.

This would delete all real users, leads, business entries, requirements, and
purchase records. --force does not override this.

Re-run without --clean to add seed data alongside existing records.
`);
        process.exit(1);
    }

    if (isLocal) return;

    if (force) {
        console.warn('\n!!  --force: writing FABRICATED data to a NON-LOCAL database.');
        console.warn('!!  Rows are prefixed [TEST] and recorded to a manifest for --undo.\n');
        return;
    }

    console.error(`
Refusing to run: ${hostname} is not a local database.

This script writes fabricated leads, business job numbers, and user accounts.
In a live CRM they are indistinguishable from real records, soft deletes leave
them behind permanently, and job numbers are unique and immutable.

Point MONGODB_URI at a local database first, for example:
  MONGODB_URI=mongodb://127.0.0.1:27017/omtraxcrm_dev

Or, if you accept the consequences, re-run with --force.
`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Random helpers
// ---------------------------------------------------------------------------

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickSome = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const int = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p) => Math.random() < p;

// A date `daysAgo` back, jittered within the day
const daysAgo = (d) => {
    const t = new Date();
    t.setDate(t.getDate() - d);
    t.setHours(int(9, 18), int(0, 59), 0, 0);
    return t;
};
const daysAhead = (d) => daysAgo(-d);

const FIRST = ['Rohan', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anjali', 'Karan', 'Neha', 'Arjun', 'Divya',
    'Manoj', 'Pooja', 'Rahul', 'Kavita', 'Sanjay', 'Meera', 'Nikhil', 'Ritu', 'Suresh', 'Tanvi'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Iyer', 'Singh', 'Joshi', 'Mehta',
    'Kulkarni', 'Chopra', 'Rao', 'Desai', 'Bose'];

const COMPANY_HEAD = ['Ascent', 'Meridian', 'BlueRock', 'Nexa', 'Orbit', 'Vertex', 'Silverline', 'Corevia',
    'Northwind', 'Zenith', 'Trilogy', 'Kinetic', 'Lumen', 'Pinnacle', 'Crestline', 'Aurora', 'Quanta', 'Ridgeway'];
const COMPANY_TAIL = ['Technologies', 'Industries', 'Logistics', 'Pharma', 'Systems', 'Consulting',
    'Motors', 'Labs', 'Networks', 'Enterprises', 'Solutions', 'Analytics'];

const DESIGNATIONS = ['HR Manager', 'Admin Head', 'Operations Manager', 'Facility Manager', 'Director',
    'Procurement Lead', 'General Manager', 'Founder', 'Plant Head', 'Office Administrator'];

// Requirement list is copied from the New Entry form — "HR & Recruitment" is the
// one value that routes a lead into the HR department.
const REQUIREMENTS = ['HHG Relocation', 'Office Relocation', 'Demo Relocation', 'Lab Movements',
    'Furniture Movements', 'Car Movements', 'Data Center Movements', 'IT Assets Movements',
    'HR & Recruitment', 'Real Estate'];

const STATUSES = ['Hot', 'Warm', 'Cold', 'Closed', 'Active'];
const BRANCHES = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Hyderabad', 'Kolkata', 'Pune', 'Gurugram', 'Ahmedabad'];
const CITIES = ['New Delhi', 'Mumbai', 'Bengaluru', 'Chennai', 'Hyderabad', 'Kolkata', 'Pune',
    'Gurugram', 'Ahmedabad', 'Noida', 'Jaipur', 'Coimbatore'];

const POSITIONS = ['Warehouse Supervisor', 'Logistics Coordinator', 'Accounts Executive', 'HR Generalist',
    'Field Sales Executive', 'Operations Analyst', 'Packing Supervisor', 'Fleet Manager',
    'Customer Support Lead', 'Data Entry Operator'];

const FEEDBACKS = ['Hold', 'Rejected', 'Short Listed', 'Feedback Pending'];

const SUPPLIERS = ['Shakti Packaging', 'Gupta Traders', 'National Timber Co.', 'SafeGuard Industrial',
    'Metro Stationers', 'Everest Plywood', 'Prime Foam Products', 'Bharat Tools & Hardware'];

const SALES_REMARKS = [
    'Initial call done, sharing quotation this week.',
    'Client comparing three vendors, decision by month end.',
    'Site survey scheduled, awaiting confirmation.',
    'Budget approved internally, negotiating final rate.',
    'Asked to follow up after their board meeting.',
    'Requirement postponed to next quarter.',
    'Deal closed, moving to operations handover.',
    'Wants a revised estimate excluding storage.',
    'Referred by an existing client, warm intro.',
    'Not interested for now, keep in pipeline.',
];

const FOLLOWUP_REMARKS = [
    'Spoke to the contact, quotation received well.',
    'Call unanswered, will retry tomorrow.',
    'Shared revised pricing over email.',
    'Client asked for reference customers.',
    'Site visit completed, estimate being prepared.',
    'Negotiated rate, awaiting internal approval.',
    'Confirmed move dates with the client.',
    'Client on leave, follow up next week.',
];

// Everything this script creates is prefixed so a human looking at the CRM can
// immediately tell a seeded row from a real one.
const TEST_TAG = '[TEST]';

const fullName = () => `${pick(FIRST)} ${pick(LAST)}`;
const companyName = () => `${TEST_TAG} ${pick(COMPANY_HEAD)} ${pick(COMPANY_TAIL)}`;
const phone = () => `9${int(100000000, 999999999)}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// Email TLD must be 2-3 chars to satisfy the User schema's validation regex.
const emailFor = (name, i) => `${slug(name.split(' ')[0])}${i}@omtrax.dev`;

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function wipe() {
    console.log('Cleaning existing data...');
    const models = [User, SalesEntry, FollowUp, Business, RecruitmentEntry,
        PurchaseEntry, Item, Supplier, StorageLocation, Notification, DismissedReminder];
    for (const M of models) {
        const { deletedCount } = await M.deleteMany({});
        if (deletedCount) console.log(`  ${M.modelName}: removed ${deletedCount}`);
    }
    console.log('');
}

async function seedUsers() {
    console.log('Seeding users...');
    const made = { admin: null, sales: [], manager: null, recruiters: [], teamLeader: null, purchase: [] };

    // create() is used throughout so the password-hashing pre('save') hook runs.
    // insertMany would store passwords in plain text.
    made.admin = await User.create({
        username: 'admin', password: 'Admin@123', name: 'Test Admin',
        email: 'admin@omtrax.dev', role: 'admin', department: 'relocation',
        branch: 'Delhi', phoneNumber: phone(), isActive: true,
    });

    made.manager = await User.create({
        username: 'manager', password: 'Manager@123', name: fullName(),
        email: 'manager@omtrax.dev', role: 'manager', department: 'relocation',
        branch: 'Delhi', phoneNumber: phone(), isActive: true,
    });

    for (let i = 1; i <= 5; i++) {
        const name = fullName();
        made.sales.push(await User.create({
            username: `sales${i}`, password: 'Sales@123', name,
            email: emailFor(name, `sales${i}`), role: 'salesperson', department: 'relocation',
            branch: pick(BRANCHES), phoneNumber: phone(), isActive: i !== 5, // one inactive, to exercise the UI
        }));
    }

    made.teamLeader = await User.create({
        username: 'hrlead', password: 'Hr@123456', name: fullName(),
        email: 'hrlead@omtrax.dev', role: 'team_leader', department: 'hr',
        branch: 'Delhi', phoneNumber: phone(), isActive: true,
    });

    // Names match config/hr.js RECRUITERS so the fallback dropdown lines up.
    for (const [i, name] of ['Ridhi Malhotra', 'Priya Sethi', 'Rishita Jain'].entries()) {
        made.recruiters.push(await User.create({
            username: `recruiter${i + 1}`, password: 'Hr@123456', name,
            email: emailFor(name, `rec${i + 1}`), role: 'recruiter', department: 'hr',
            branch: 'Delhi', phoneNumber: phone(), isActive: true,
        }));
    }

    // Purchase: a purchase manager plus location managers whose `branch` MATCHES a
    // storage location name — that match is what makes the receipt workflow work.
    made.purchase.push(await User.create({
        username: 'purchase1', password: 'Purchase@123', name: fullName(),
        email: 'purchase1@omtrax.dev', role: 'purchase_manager', department: 'purchase',
        branch: 'Delhi HO', phoneNumber: phone(), isActive: true,
    }));
    made.purchase.push(await User.create({
        username: 'warehouse1', password: 'Purchase@123', name: fullName(),
        email: 'warehouse1@omtrax.dev', role: 'warehouse_manager', department: 'purchase',
        branch: 'Delhi HO', phoneNumber: phone(), isActive: true,
    }));
    made.purchase.push(await User.create({
        username: 'branch1', password: 'Purchase@123', name: fullName(),
        email: 'branch1@omtrax.dev', role: 'branch_manager', department: 'purchase',
        branch: 'Mumbai', phoneNumber: phone(), isActive: true,
    }));

    const total = 2 + made.sales.length + 1 + made.recruiters.length + made.purchase.length;
    console.log(`  ${total} users created\n`);
    return made;
}

async function seedSalesAndFollowUps(users) {
    console.log('Seeding sales leads and follow-ups...');
    const owners = [...users.sales, users.manager];
    const leads = [];
    let followUpCount = 0;

    for (let i = 0; i < 60; i++) {
        const owner = pick(owners);
        const requirement = pick(REQUIREMENTS);
        const status = pick(STATUSES);
        const created = daysAgo(int(1, 90));

        // Spread follow-up dates across overdue / today / upcoming so the reminder
        // panel and the today/overdue endpoints all have something to show.
        let nextFollowUp;
        const r = Math.random();
        if (r < 0.2) nextFollowUp = daysAgo(int(1, 14));      // overdue
        else if (r < 0.32) nextFollowUp = daysAgo(0);          // today
        else nextFollowUp = daysAhead(int(1, 30));             // upcoming

        const lead = await SalesEntry.create({
            companyName: companyName(),
            contactPerson: fullName(),
            contactNumber: phone(),
            contactEmail: `contact${i}@${slug(pick(COMPANY_HEAD))}.dev`,
            designation: pick(DESIGNATIONS),
            requirement,
            location: pick(CITIES),
            remark: pick(SALES_REMARKS),
            nextFollowUpDate: nextFollowUp,
            queryStatus: status,
            salesPerson: owner._id,
            branch: owner.branch,
            // HR & Recruitment leads live in the HR department; everything else relocation
            department: requirement === 'HR & Recruitment' ? 'hr' : 'relocation',
            entryDate: created,
            createdAt: created,
            newlyAssigned: chance(0.1),
        });

        // Follow-up history — mirrors what followUpController does on a real add
        const n = int(0, 4);
        for (let f = 0; f < n; f++) {
            const fu = await FollowUp.create({
                salesEntry: lead._id,
                remark: pick(FOLLOWUP_REMARKS),
                status: pick(STATUSES),
                nextFollowUpDate: nextFollowUp,
                addedBy: owner._id,
                addedByName: owner.name,
                department: lead.department,
                followUpDate: daysAgo(int(1, 60)),
            });
            lead.followUpHistory.push(fu._id);
            followUpCount++;
        }
        if (n > 0) {
            lead.totalFollowUps = n;
            lead.lastFollowUpDate = daysAgo(int(1, 20));
            await lead.save();
        }

        leads.push(lead);
    }

    console.log(`  ${leads.length} leads, ${followUpCount} follow-ups\n`);
    return leads;
}

async function seedBusiness(users, leads) {
    console.log('Seeding business entries...');
    const owners = [...users.sales, users.manager];
    const closedLeads = leads.filter((l) => l.department === 'relocation');
    let n = 0;

    for (let i = 0; i < 30; i++) {
        const owner = pick(owners);
        // Reuse a real lead's company name where possible so the two modules line up
        const client = chance(0.7) ? pick(closedLeads).companyName : companyName();
        const created = daysAgo(int(1, 75));

        await Business.create({
            client,
            // Job numbers are unique AND immutable — namespaced so seeded rows are
            // obvious and can never collide with a real one.
            jobNumber: `TEST-JOB-${String(1000 + i)}`,
            estimateAmount: int(25, 900) * 1000,
            remarks: pick(SALES_REMARKS),
            salesPerson: owner._id,
            salesPersonName: owner.name,
            branch: owner.branch,
            department: 'relocation',
            entryDate: created,
            createdAt: created,
        });
        n++;
    }
    console.log(`  ${n} business entries\n`);
}

async function seedRecruitment(users, leads) {
    console.log('Seeding HR requirements...');
    const hrLeads = leads.filter((l) => l.department === 'hr');
    let n = 0;

    for (let i = 0; i < 25; i++) {
        // Roughly half originate from a real HR lead, the rest created inside HR
        const source = i < hrLeads.length && chance(0.6) ? hrLeads[i] : null;
        const recruiter = chance(0.85) ? pick(users.recruiters) : null; // some unassigned
        const assigner = chance(0.5) ? users.admin : users.teamLeader;
        const created = daysAgo(int(1, 80));
        const cvs = recruiter ? int(0, 12) : 0;

        await RecruitmentEntry.create({
            salesPersonName: source ? pick(users.sales).name : pick(users.sales).name,
            positionReceivedDate: created,
            clientName: source ? source.companyName : companyName(),
            position: pick(POSITIONS),
            salesPerson: source ? source.salesPerson : undefined,
            sourceSalesEntry: source ? source._id : undefined,
            recruiter: recruiter ? recruiter._id : undefined,
            recruiterName: recruiter ? recruiter.name : undefined,
            cvSubmissionDate: cvs > 0 ? daysAgo(int(1, 40)) : undefined,
            cvsSubmitted: cvs,
            feedback: cvs > 0 ? pick(FEEDBACKS) : 'Feedback Pending',
            remarks: chance(0.6) ? pick(SALES_REMARKS) : '',
            assignedBy: assigner._id,
            assignedByName: assigner.name,
            department: 'hr',
            entryDate: created,
            assignDate: created,
            createdAt: created,
        });
        n++;
    }
    console.log(`  ${n} recruitment requirements\n`);
}

async function seedPurchaseMasters(users) {
    console.log('Seeding purchase master data...');
    const creator = users.purchase[0];

    for (const item of pickSome(MASTER_ITEMS, 20)) {
        await Item.create({
            name: item.name, category: item.category, unit: item.unit,
            department: 'purchase', createdBy: creator._id, createdByName: creator.name,
        });
    }
    for (const name of SUPPLIERS) {
        await Supplier.create({
            name, contact: phone(), department: 'purchase',
            createdBy: creator._id, createdByName: creator.name,
        });
    }
    for (const name of STORAGE_LOCATIONS) {
        await StorageLocation.create({
            name, type: /warehouse|HO/i.test(name) ? 'Warehouse' : 'Branch',
            department: 'purchase', createdBy: creator._id, createdByName: creator.name,
        });
    }
    console.log(`  20 items, ${SUPPLIERS.length} suppliers, ${STORAGE_LOCATIONS.length} locations\n`);
}

async function seedPurchaseEntries(users) {
    console.log('Seeding purchase materials...');
    const creator = users.purchase[0];
    const managers = users.purchase.slice(1);
    // Weighted toward the two locations that actually have a manager, so the
    // receipt workflow is exercisable rather than permanently stuck pending.
    const locations = ['Delhi HO', 'Delhi HO', 'Mumbai', 'Mumbai', ...pickSome(STORAGE_LOCATIONS, 3)];
    let n = 0, dispatches = 0, returns = 0;

    for (let i = 0; i < 35; i++) {
        const master = pick(MASTER_ITEMS);
        const location = pick(locations);
        const qty = int(10, 500);
        const price = int(20, 2500);
        const purchased = daysAgo(int(1, 70));

        // Mix of lifecycle stages: mostly received, some awaiting, a few rejected
        const r = Math.random();
        const receiptStatus = r < 0.7 ? 'received' : r < 0.9 ? 'pending' : 'not_received';
        const manager = managers.find((m) => m.branch === location) || pick(managers);

        const entry = new PurchaseEntry({
            itemName: master.name,
            storageLocation: location,
            supplier: pick(SUPPLIERS),
            purchaseDate: purchased,
            quantityPurchased: qty,
            unit: master.unit,
            unitPrice: price,
            totalAmount: qty * price,
            invoiceNumber: `TEST-INV-${int(10000, 99999)}`,
            remarks: chance(0.4) ? 'Bulk order for upcoming projects.' : '',
            receiptStatus,
            department: 'purchase',
            createdBy: creator._id,
            createdByName: creator.name,
            createdByUsername: creator.username,
            createdByBranch: creator.branch,
        });

        entry.activity.push({
            action: 'purchased', at: purchased, byUser: creator._id,
            byName: creator.name, byRole: creator.role, quantity: qty,
            note: `Purchased ${qty} ${master.unit || ''}`.trim(),
        });

        if (receiptStatus !== 'pending') {
            const receivedAt = new Date(purchased.getTime() + int(1, 4) * 86400000);
            entry.receivedBy = manager._id;
            entry.receivedByName = manager.name;
            entry.receivedAt = receivedAt;
            entry.receiptNote = receiptStatus === 'received' ? '' : 'Consignment damaged in transit.';
            entry.activity.push({
                action: receiptStatus, at: receivedAt, byUser: manager._id,
                byName: manager.name, byRole: manager.role,
                note: receiptStatus === 'received' ? 'Marked received' : 'Marked not received',
            });
        }

        // Only received stock can move
        if (receiptStatus === 'received') {
            let out = 0;
            for (let d = 0; d < int(0, 3); d++) {
                const dq = int(1, Math.max(1, Math.floor(qty / 4)));
                if (dq > qty - out) break;
                const at = new Date(entry.receivedAt.getTime() + int(1, 20) * 86400000);
                const jobNumber = `TEST-JOB-${int(1000, 1029)}`; // matches the seeded business range
                entry.dispatches.push({
                    dispatchDate: at, quantity: dq, jobNumber, location: pick(CITIES),
                    remark: chance(0.3) ? 'Urgent site requirement.' : '',
                    createdBy: manager._id, createdByName: manager.name,
                });
                entry.activity.push({
                    action: 'dispatch', at, byUser: manager._id, byName: manager.name,
                    byRole: manager.role, quantity: dq, jobNumber, note: 'Dispatched to site',
                });
                out += dq;
                dispatches++;
            }
            // A return can never exceed what is currently out on jobs
            if (out > 0 && chance(0.35)) {
                const rq = int(1, out);
                const at = new Date(entry.receivedAt.getTime() + int(21, 40) * 86400000);
                entry.returns.push({
                    returnDate: at, quantity: rq, location,
                    createdBy: manager._id, createdByName: manager.name,
                });
                entry.activity.push({
                    action: 'return', at, byUser: manager._id, byName: manager.name,
                    byRole: manager.role, quantity: rq, note: `Returned ${rq} to ${location}`,
                });
                returns++;
            }
        }

        // save() (not insertMany) so the pre-save hook recomputes availableStock
        await entry.save();
        n++;
    }
    console.log(`  ${n} materials, ${dispatches} dispatches, ${returns} returns\n`);
}

// ---------------------------------------------------------------------------
// Undo — removes only what this script created, identified by its markers.
// ---------------------------------------------------------------------------

const TEST_RX = /^\[TEST\]/;

async function undo() {
    console.log('Removing seeded data (marker-matched only)...\n');

    // Leads first, so their follow-ups can be found by reference
    const leads = await SalesEntry.find({ companyName: TEST_RX }).select('_id');
    const leadIds = leads.map((l) => l._id);

    const results = [
        ['Follow-ups', (await FollowUp.deleteMany({ salesEntry: { $in: leadIds } })).deletedCount],
        ['Sales leads', (await SalesEntry.deleteMany({ _id: { $in: leadIds } })).deletedCount],
        ['Business entries', (await Business.deleteMany({ jobNumber: /^TEST-JOB-/ })).deletedCount],
        ['HR requirements', (await RecruitmentEntry.deleteMany({ clientName: TEST_RX })).deletedCount],
        ['Purchase materials', (await PurchaseEntry.deleteMany({ invoiceNumber: /^TEST-INV-/ })).deletedCount],
        ['Notifications', (await Notification.deleteMany({ companyName: TEST_RX })).deletedCount],
        ['Users', (await User.deleteMany({ email: /@omtrax\.dev$/ })).deletedCount],
    ];

    results.forEach(([k, v]) => console.log(`  ${k.padEnd(20)} removed ${v}`));
    console.log('\nSeeded data removed. Real records were not touched.');
}

async function writeManifest(dbName) {
    const fs = require('fs');
    const manifest = {
        seededAt: new Date().toISOString(),
        database: dbName,
        markers: {
            users: 'email ends with @omtrax.dev',
            salesEntries: 'companyName starts with [TEST]',
            business: 'jobNumber starts with TEST-JOB-',
            recruitment: 'clientName starts with [TEST]',
            purchase: 'invoiceNumber starts with TEST-INV-',
        },
        undo: 'node scripts/seedTestData.js --undo --force',
    };
    const file = path.join(__dirname, '..', 'seed-manifest.json');
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    console.log(`Manifest written to ${file}\n`);
}

async function summary() {
    const rows = [
        ['Users', await User.countDocuments()],
        ['Sales leads', await SalesEntry.countDocuments()],
        ['Follow-ups', await FollowUp.countDocuments()],
        ['Business entries', await Business.countDocuments()],
        ['HR requirements', await RecruitmentEntry.countDocuments()],
        ['Purchase materials', await PurchaseEntry.countDocuments()],
        ['Items', await Item.countDocuments()],
        ['Suppliers', await Supplier.countDocuments()],
        ['Storage locations', await StorageLocation.countDocuments()],
        ['Notifications', await Notification.countDocuments()],
    ];
    console.log('Collection counts');
    rows.forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${v}`));
}

async function main() {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const clean = args.includes('--clean');
    const summaryOnly = args.includes('--summary');
    const undoOnly = args.includes('--undo');

    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Ensure CRM Backend/.env exists.');
        process.exit(1);
    }

    guardTarget(process.env.MONGODB_URI, force, clean);
    const { hostname, dbName } = describeTarget(process.env.MONGODB_URI);
    const isLocal = LOCAL_HOSTS.includes(hostname);

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected.\n');

    if (summaryOnly) return summary();
    if (undoOnly) return undo();

    if (clean) await wipe();

    const users = await seedUsers();
    const leads = await seedSalesAndFollowUps(users);
    await seedBusiness(users, leads);
    await seedRecruitment(users, leads);
    // Item/supplier/location masters are shared autocomplete data. Off localhost
    // they would clutter the real masters permanently, and purchase entries store
    // itemName as a plain string anyway — so skip them.
    if (isLocal) await seedPurchaseMasters(users);
    else console.log('Skipping purchase master data (not local — avoids polluting real masters).\n');
    await seedPurchaseEntries(users);

    await writeManifest(dbName);
    await summary();

    console.log(`
Logins (all seeded accounts)
  admin       / Admin@123      CRM Admin — every department
  manager     / Manager@123    Relocation manager — sees all relocation data
  sales1..4   / Sales@123      Salespersons (sales5 is deactivated on purpose)
  hrlead      / Hr@123456      HR team leader
  recruiter1..3 / Hr@123456    Recruiters
  purchase1   / Purchase@123   Purchase manager (Delhi HO)
  warehouse1  / Purchase@123   Warehouse manager (Delhi HO)
  branch1     / Purchase@123   Branch manager (Mumbai)
`);
}

main()
    .catch((err) => {
        console.error('\nFailed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
