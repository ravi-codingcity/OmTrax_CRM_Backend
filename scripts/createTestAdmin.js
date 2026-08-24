/**
 * Creates (or resets) a test Admin account for local development.
 *
 * A CRM Admin can reach every department, create users, assign leads, and see
 * all data — so this account exists only to work on the app locally.
 *
 * SAFETY: the script refuses to run against any database that is not on
 * localhost. Seeding a known-password admin into a shared or production
 * database would hand anyone who guesses it full control of the CRM. If you
 * genuinely need to target a remote host, pass --force and own that decision.
 *
 * USAGE (run from the CRM Backend folder):
 *   node scripts/createTestAdmin.js              # create / reset the test admin
 *   node scripts/createTestAdmin.js status       # show whether it exists
 *   node scripts/createTestAdmin.js delete       # remove it
 *
 * OPTIONAL overrides (env vars):
 *   ADMIN_USERNAME  (default admin)
 *   ADMIN_PASSWORD  (default Admin@123)
 *   ADMIN_EMAIL     (default admin@omtrax.dev)
 *   ADMIN_NAME      (default Test Admin)
 *   ADMIN_BRANCH    (default Delhi)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../src/models/User');

const CONFIG = {
    username: (process.env.ADMIN_USERNAME || 'admin').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'Admin@123',
    email: (process.env.ADMIN_EMAIL || 'admin@omtrax.dev').toLowerCase(),
    name: process.env.ADMIN_NAME || 'Test Admin',
    branch: process.env.ADMIN_BRANCH || 'Delhi',
    role: 'admin',
    department: 'relocation', // an admin can switch departments in the UI anyway
};

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'];

// Pull the host out of a connection string without logging credentials.
function describeTarget(uri) {
    const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
    const afterAuth = withoutScheme.includes('@')
        ? withoutScheme.slice(withoutScheme.lastIndexOf('@') + 1)
        : withoutScheme;
    const host = afterAuth.split('/')[0].split(',')[0];
    const dbName = (afterAuth.split('/')[1] || '').split('?')[0] || '(default)';
    return { host, hostname: host.split(':')[0], dbName };
}

function guardTarget(uri, force) {
    const { host, hostname, dbName } = describeTarget(uri);
    const isLocal = LOCAL_HOSTS.includes(hostname);

    console.log(`Target : ${host}/${dbName}`);

    if (isLocal || force) {
        if (!isLocal) {
            console.warn('\n!!  --force given: writing an admin to a NON-LOCAL database.');
            console.warn('!!  Change this password immediately after you are done.\n');
        }
        return { host, dbName };
    }

    console.error(`
Refusing to run: ${hostname} is not a local database.

This script seeds an admin with a known password. Putting that in a shared or
production database gives anyone who guesses it full control of the CRM.

Point MONGODB_URI at a local database first, for example:
  MONGODB_URI=mongodb://127.0.0.1:27017/omtraxcrm_dev

Or, if you accept the risk, re-run with --force.
`);
    process.exit(1);
}

async function main() {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const command = args.find((a) => !a.startsWith('--')) || 'create';

    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Ensure CRM Backend/.env exists.');
        process.exit(1);
    }

    guardTarget(process.env.MONGODB_URI, force);

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected.\n');

    const existing = await User.findOne({
        $or: [{ username: CONFIG.username }, { email: CONFIG.email }],
    });

    if (command === 'status') {
        if (!existing) {
            console.log(`No account found for "${CONFIG.username}".`);
        } else {
            console.log('Account found:');
            console.log(`  name       : ${existing.name}`);
            console.log(`  username   : ${existing.username}`);
            console.log(`  email      : ${existing.email}`);
            console.log(`  role       : ${existing.role}`);
            console.log(`  department : ${existing.department}`);
            console.log(`  branch     : ${existing.branch || '(none)'}`);
            console.log(`  active     : ${existing.isActive}`);
            console.log(`  lastLogin  : ${existing.lastLogin || 'never'}`);
        }
        return;
    }

    if (command === 'delete') {
        if (!existing) {
            console.log('Nothing to delete.');
            return;
        }
        await User.deleteOne({ _id: existing._id });
        console.log(`Deleted "${existing.username}".`);
        return;
    }

    // create / reset
    let user = existing;
    if (user) {
        // Assigning triggers the pre-save hook, which re-hashes the password.
        user.password = CONFIG.password;
        user.name = CONFIG.name;
        user.role = CONFIG.role;
        user.department = CONFIG.department;
        user.branch = CONFIG.branch;
        user.isActive = true;
        await user.save();
        console.log('Existing account found — password and details reset.');
    } else {
        user = await User.create({
            username: CONFIG.username,
            password: CONFIG.password, // hashed by the model's pre-save hook
            name: CONFIG.name,
            email: CONFIG.email,
            role: CONFIG.role,
            department: CONFIG.department,
            branch: CONFIG.branch,
            isActive: true,
        });
        console.log('Admin account created.');
    }

    console.log('\n  Login with');
    console.log(`    username : ${CONFIG.username}`);
    console.log(`    password : ${CONFIG.password}`);
    console.log(`\n  id: ${user._id}`);
    console.log('\nAdmins choose a department after login (Relocation / HR / Purchase).');
}

main()
    .catch((err) => {
        console.error('\nFailed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
