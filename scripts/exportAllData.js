/**
 * Exports every collection in the CRM database to JSON files.
 *
 * USAGE (run from the CRM_backend folder):
 *   node scripts/exportAllData.js                 # writes to ./export/<timestamp>/
 *   node scripts/exportAllData.js --out ./backup  # custom output folder
 *   node scripts/exportAllData.js --pretty        # indented JSON (larger files)
 *
 * One file per collection, named <collection>.json, containing an array of
 * documents. A _manifest.json records the database, timestamp and doc counts.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dns = require('dns');
// Match the app's DB config: resolve MongoDB Atlas SRV records via Google DNS.
dns.setServers(['8.8.8.8', '8.8.4.4']);
dns.setDefaultResultOrder('ipv4first');

const fs = require('fs');
const mongoose = require('mongoose');

function parseArgs(argv) {
    const args = { out: null, pretty: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--pretty') args.pretty = true;
        else if (argv[i] === '--out') args.out = argv[++i];
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Ensure CRM_backend/.env exists and contains MONGODB_URI.');
        process.exit(1);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.resolve(args.out || path.join(__dirname, '..', 'export', stamp));
    fs.mkdirSync(outDir, { recursive: true });

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, family: 4 });

    const db = mongoose.connection.db;
    console.log(`Connected to database: ${db.databaseName}`);

    const collections = (await db.listCollections().toArray())
        .filter((c) => c.type !== 'view')
        .map((c) => c.name)
        .sort();

    const counts = {};

    for (const name of collections) {
        const docs = await db.collection(name).find({}).toArray();
        const file = path.join(outDir, `${name}.json`);
        fs.writeFileSync(file, JSON.stringify(docs, null, args.pretty ? 2 : 0), 'utf8');
        counts[name] = docs.length;
        console.log(`  ${name}: ${docs.length} docs -> ${path.basename(file)}`);
    }

    const manifest = {
        database: db.databaseName,
        exportedAt: new Date().toISOString(),
        collections: counts,
        totalDocuments: Object.values(counts).reduce((a, b) => a + b, 0),
    };
    fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`\nExported ${collections.length} collections (${manifest.totalDocuments} documents) to:`);
    console.log(outDir);

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error(`Export failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
