/**
 * Temporary Relocation "Business" sub-user manager.
 *
 * Creates (or removes) a sandboxed sub-account that can ONLY view and add
 * Business entries on behalf of a primary salesperson (default: Anchal). Every
 * Business entry it adds is owned by, and visible only for, that salesperson.
 * The account can access nothing else in the CRM.
 *
 * This entire feature is self-contained and removable:
 *   - Delete the sub-user (run this script with --delete) to fully retire it.
 *   - The `business_sub` role and `linkedSalesPerson` field are inert for every
 *     other account, so leaving the code in place changes nothing.
 *
 * USAGE (run from the CRM_backend folder):
 *   node scripts/manageBusinessSubUser.js create      # create / re-link the sub-user
 *   node scripts/manageBusinessSubUser.js delete      # permanently remove it
 *   node scripts/manageBusinessSubUser.js status      # show current state
 *
 * OPTIONAL overrides (env vars):
 *   SUB_EMAIL     (default westsales@omtrax.com)
 *   SUB_USERNAME  (default westsales)
 *   SUB_PASSWORD  (default Welcome@123 — change after first login)
 *   SUB_BRANCH    (default Delhi)
 *   PRIMARY_NAME  (default Anchal)  — salesperson to link to (name match)
 *   PRIMARY_ID    (a specific salesperson User _id; overrides PRIMARY_NAME)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../src/models/User');

const CONFIG = {
    email: (process.env.SUB_EMAIL || 'westsales@omtrax.com').toLowerCase(),
    username: (process.env.SUB_USERNAME || 'westsales').toLowerCase(),
    password: process.env.SUB_PASSWORD || 'Welcome@123',
    name: 'West Sales (Anchal)',
    branch: process.env.SUB_BRANCH || 'Delhi',
    department: 'relocation',
    role: 'business_sub',
    primaryName: process.env.PRIMARY_NAME || 'Anchal',
    primaryId: process.env.PRIMARY_ID || null,
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Locate the primary salesperson (Anchal) this sub-user reflects under.
async function findPrimarySalesperson() {
    if (CONFIG.primaryId) {
        const byId = await User.findById(CONFIG.primaryId);
        if (!byId) throw new Error(`No user found for PRIMARY_ID=${CONFIG.primaryId}`);
        return byId;
    }
    const rx = new RegExp(`^${escapeRegex(CONFIG.primaryName)}$`, 'i');
    const matches = await User.find({
        department: 'relocation',
        role: { $in: ['salesperson', 'manager'] },
        $or: [{ name: rx }, { username: rx }],
    });
    if (matches.length === 0) {
        // Fall back to a looser "contains" match to help the operator
        const loose = await User.find({
            department: 'relocation',
            name: new RegExp(escapeRegex(CONFIG.primaryName), 'i'),
        }).select('name username role');
        const hint = loose.length
            ? `\nDid you mean one of these? ${loose.map((u) => `${u.name} (@${u.username}, ${u.role})`).join(', ')}`
            : '';
        throw new Error(`No relocation salesperson named "${CONFIG.primaryName}" found.${hint}\nTip: pass PRIMARY_ID=<userId> to link exactly.`);
    }
    if (matches.length > 1) {
        const list = matches.map((u) => `${u.name} (@${u.username}, id=${u._id})`).join('\n  ');
        throw new Error(`Multiple salespersons match "${CONFIG.primaryName}":\n  ${list}\nRe-run with PRIMARY_ID=<userId> to pick one.`);
    }
    return matches[0];
}

async function create() {
    const primary = await findPrimarySalesperson();
    console.log(`Primary salesperson: ${primary.name} (@${primary.username}, id=${primary._id})`);

    let sub = await User.findOne({ $or: [{ email: CONFIG.email }, { username: CONFIG.username }] });

    if (sub) {
        // Idempotent: make sure existing account points at the right salesperson
        sub.role = CONFIG.role;
        sub.department = CONFIG.department;
        sub.branch = CONFIG.branch;
        sub.linkedSalesPerson = primary._id;
        sub.isActive = true;
        await sub.save();
        console.log(`\n✔ Updated existing sub-user "${sub.username}" and linked it to ${primary.name}.`);
    } else {
        sub = await User.create({
            username: CONFIG.username,
            email: CONFIG.email,
            password: CONFIG.password, // hashed by the User pre-save hook
            name: CONFIG.name,
            role: CONFIG.role,
            department: CONFIG.department,
            branch: CONFIG.branch,
            linkedSalesPerson: primary._id,
            isActive: true,
        });
        console.log(`\n✔ Created sub-user linked to ${primary.name}.`);
        console.log('  Login credentials:');
        console.log(`    Username: ${CONFIG.username}`);
        console.log(`    Password: ${CONFIG.password}   (ask them to change it after first login)`);
    }

    console.log('\n  This account can ONLY view/add Business entries for ' + primary.name + '.');
    console.log('  To remove it later:  node scripts/manageBusinessSubUser.js delete');
}

async function remove() {
    const sub = await User.findOne({ email: CONFIG.email, role: CONFIG.role });
    if (!sub) {
        console.log(`No sub-user found with email ${CONFIG.email} (role ${CONFIG.role}). Nothing to delete.`);
        return;
    }
    await User.deleteOne({ _id: sub._id });
    console.log(`✔ Deleted sub-user "${sub.username}" (${sub.email}).`);
    console.log('  All Business entries it added remain under the linked salesperson — nothing else is affected.');
}

async function status() {
    const sub = await User.findOne({ email: CONFIG.email }).populate('linkedSalesPerson', 'name username');
    if (!sub) {
        console.log(`No sub-user exists for ${CONFIG.email}.`);
        return;
    }
    console.log('Sub-user status:');
    console.log(`  username : ${sub.username}`);
    console.log(`  email    : ${sub.email}`);
    console.log(`  role     : ${sub.role}`);
    console.log(`  branch   : ${sub.branch}`);
    console.log(`  active   : ${sub.isActive}`);
    console.log(`  linked to: ${sub.linkedSalesPerson ? `${sub.linkedSalesPerson.name} (@${sub.linkedSalesPerson.username})` : '(none)'}`);
}

(async () => {
    const action = (process.argv[2] || 'create').toLowerCase();
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Ensure CRM_backend/.env exists and contains MONGODB_URI.');
        process.exit(1);
    }
    try {
        await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, family: 4 });
        console.log('Connected to MongoDB.\n');
        if (action === 'create') await create();
        else if (action === 'delete') await remove();
        else if (action === 'status') await status();
        else {
            console.error(`Unknown action "${action}". Use: create | delete | status`);
            process.exitCode = 1;
        }
    } catch (err) {
        console.error('\nError:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();
