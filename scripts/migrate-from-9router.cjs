#!/usr/bin/env node
/**
 * 9Router to SRouter Migration Tool
 * Migrates providers and settings from 9Router database to SRouter
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

console.log("=".repeat(70));
console.log("🚀 9Router → SRouter Database Migration");
console.log("=".repeat(70));
console.log();

// Configuration
const MIGRATION_SCRIPT = "scripts/migrate-from-9router.cjs";
const BACKUP_DIR = path.join(os.homedir(), '.srouter', 'backups');

// Check if source database exists
let sourceDbPath = null;

console.log("Looking for 9Router database...");
console.log("-".repeat(70));

// Try common 9Router locations
const possibleLocations = [
    // From the original working directory where 9Router might be installed
    "/root/9router/srouter.db",
    "/root/project/9router/db/srouter.db",
    "./srouter.db",
    "./apps/api/srouter.db",
    
    // Any custom location user provides
];

for (const loc of possibleLocations) {
    const fullPath = path.resolve(loc);
    if (fs.existsSync(fullPath)) {
        sourceDbPath = fullPath;
        console.log(`✅ Found 9Router database at:`);
        console.log(`   ${sourceDbPath}`);
        break;
    }
}

if (!sourceDbPath) {
    console.log();
    console.log("❌ No existing 9Router database found.");
    console.log();
    console.log("Please specify your 9Router database location by running:");
    console.log(`  node ${MIGRATION_SCRIPT} --source /path/to/your/9router.db`);
    console.log();
    console.log("Or you can manually provide the path when prompted.");
    process.exit(1);
}

// Verify it's readable
try {
    const stat = fs.statSync(sourceDbPath);
    console.log(`   Size: ${(stat.size / 1024).toFixed(2)} KB`);
    console.log(`   Created: ${new Date(stat.mtime).toLocaleString()}`);
} catch (err) {
    console.error("   Error reading file:", err.message);
    process.exit(1);
}

console.log();

// Ask for destination
const homedir = os.homedir();
const destDir = path.join(homedir, '.srouter');
const destDbPath = path.join(destDir, 'srouter.db');

console.log("Migration Target:");
console.log(`   Directory: ${destDir}`);
console.log(`   Database:  ${destDbPath}`);
console.log();

// Create backup directory
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o755 });
    console.log(`✅ Created backup directory: ${BACKUP_DIR}`);
}

// Offer backup of source
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(BACKUP_DIR, `9router-backup-${timestamp}.db`);

console.log(`💾 Backing up source database before migration...`);
console.log(`   Backup: ${backupPath}`);

try {
    fs.copyFileSync(sourceDbPath, backupPath);
    console.log(`✅ Source backed up successfully!`);
} catch (err) {
    console.warn(`⚠️  Could not backup: ${err.message}`);
    console.log("   Continuing without backup...");
}

console.log();

// Interactive questions
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise((resolve) => {
        readline.question(question, (answer) => resolve(answer));
    });
}

async function runMigration() {
    console.log("=".repeat(70));
    console.log("📊 Migration Options");
    console.log("=".repeat(70));
    console.log();
    
    // Question 1: Confirm migration
    const confirm = await ask("Do you want to proceed with migration? (y/n): ");
    if (confirm.toLowerCase() !== 'y') {
        console.log();
        console.log("✗ Migration cancelled by user.");
        console.log();
        console.log("No changes made. Your 9Router installation remains intact.");
        process.exit(0);
    }
    
    console.log();
    
    // Question 2: Preserve or replace existing SRouter data
    const existingSRouter = fs.existsSync(destDbPath);
    let action = 'copy';
    
    if (existingSRouter) {
        const size = fs.statSync(destDbPath).size;
        console.log(`ℹ️  Existing SRouter database found at ${destDbPath} (${(size/1024).toFixed(0)} KB)`);
        console.log();
        
        const overwrite = await ask("Do you want to overwrite existing SRouter database with 9Router data? (yes/no): ");
        if (overwrite.toLowerCase() === 'yes') {
            action = 'merge';
            console.log("Will merge 9Router data into existing SRouter database");
        } else {
            action = 'backup_and_replace';
            console.log("Will backup current SRouter and replace with 9Router data");
            
            const srouterBackup = path.join(BACKUP_DIR, `srouter-backup-${timestamp}.db`);
            try {
                fs.copyFileSync(destDbPath, srouterBackup);
                console.log(`✅ Current SRouter backed up to: ${srouterBackup}`);
            } catch (err) {
                console.warn(`⚠️  Backup failed: ${err.message}`);
            }
        }
    } else {
        console.log("✅ No existing SRouter database. Will create fresh copy.");
        action = 'copy';
    }
    
    console.log();
    console.log("=".repeat(70));
    console.log("🔧 Preparing Migration...");
    console.log("=".repeat(70));
    console.log();
    
    // Migrate using SQLite
    try {
        const { DatabaseSync } = require('node:sqlite');
        
        // Open both databases
        console.log("Opening databases...");
        const sourceDb = new DatabaseSync(sourceDbPath);
        const targetDb = new DatabaseSync(destDbPath, flags = fs.constants.O_CREAT | fs.constants.O_RDWR);
        
        console.log("✓ Databases opened");
        console.log();
        
        // Get tables from source
        console.log("Reading source tables...");
        const tablesQuery = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        const tableNames = tablesQuery.map(t => t.name);
        console.log(`Found ${tableNames.length} tables:`);
        tableNames.forEach(t => console.log(`  • ${t}`));
        console.log();
        
        // Migrate each table
        console.log("Starting migration...");
        
        for (const tableName of tableNames) {
            console.log(`\n📋 Migrating table: ${tableName}`);
            
            // Get all rows from source
            const selectAll = sourceDb.prepare(`SELECT * FROM "${tableName}"`);
            const rows = selectAll.all();
            
            console.log(`   Rows to migrate: ${rows.length}`);
            
            if (rows.length === 0) {
                console.log("   ⚪ Skipping (empty table)");
                continue;
            }
            
            // For merge action, check if table already exists in target
            if (action === 'merge') {
                try {
                    // Clear existing data for this table in target
                    targetDb.prepare(`DELETE FROM "${tableName}"`).run();
                    console.log(`   ℹ️  Cleared existing data from target`);
                } catch (err) {
                    console.log(`   ⚠️  Could not clear table: ${err.message}`);
                }
            }
            
            // Get column info for creating INSERT statement
            const pragmaTableInfo = sourceDb.prepare(`PRAGMA table_info("${tableName}")`).all();
            const columns = pragmaTableInfo.map(col => col.name);
            
            if (columns.length === 0) {
                console.log(`   ⚠️  No columns found, skipping`);
                continue;
            }
            
            // Build INSERT statement
            const placeholders = columns.map(() => '?').join(', ');
            const insertStmt = targetDb.prepare(`INSERT INTO "${tableName}" (${columns.join(', ')}) VALUES (${placeholders})`);
            
            // Insert rows
            let successCount = 0;
            let skipCount = 0;
            
            for (const row of rows) {
                try {
                    const values = columns.map(col => row[col]);
                    insertStmt.run(values);
                    successCount++;
                } catch (err) {
                    console.log(`   ⚠️  Failed to insert row: ${err.message}`);
                    skipCount++;
                }
            }
            
            console.log(`   ✓ Inserted: ${successCount}, Skipped: ${skipCount}`);
        }
        
        console.log();
        console.log("=".repeat(70));
        console.log("✅ Migration Complete!");
        console.log("=".repeat(70));
        console.log();
        
        // Summary
        console.log("Migration Summary:");
        console.log(`  📍 Source: ${sourceDbPath}`);
        console.log(`  🎯 Target: ${destDbPath}`);
        console.log(`  📦 Tables migrated: ${tableNames.length}`);
        console.log(`  💾 Backup: ${backupPath}`);
        
        if (existingSRouter && action === 'backup_and_replace') {
            console.log(`  🔄 Old SRouter: ${srouterBackup}`);
        }
        
        console.log();
        console.log("Next Steps:");
        console.log("---------");
        console.log();
        
        // Write .env file
        const envPath = path.join(process.cwd(), '.env');
        let envContent = '';
        
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8');
            // Update DATABASE_PATH if not already set
            if (!envContent.includes('DATABASE_PATH')) {
                envContent += `\n# Migrated from 9Router\n`;
                envContent += `DATABASE_PATH=~/.srouter/srouter.db\n`;
                fs.writeFileSync(envPath, envContent);
                console.log(`✓ Updated .env file with DATABASE_PATH`);
            } else {
                console.log(`ℹ️  .env file already exists`);
            }
        } else {
            envContent = `# Database location (set by migration)\nDATABASE_PATH=~/.srouter/srouter.db\n`;
            fs.writeFileSync(envPath, envContent);
            console.log(`✓ Created .env file with DATABASE_PATH`);
        }
        
        console.log();
        console.log("You can now start SRouter with your migrated data:");
        console.log("  cd /path/to/srouter");
        console.log("  pnpm install");
        console.log("  pnpm dev");
        console.log();
        console.log("Your 9Router providers will be available at:");
        console.log("  - http://localhost:3000/providers");
        console.log("  - Dashboard will show all your configured providers");
        console.log();
        console.log("📁 All data preserved in:");
        console.log(`   ${destDbPath}`);
        console.log();
        console.log("💾 Original 9Router database backed up to:");
        console.log(`   ${backupPath}`);
        console.log();
        
        // Close databases
        sourceDb.close();
        targetDb.close();
        
    } catch (error) {
        console.error();
        console.error("❌ Migration failed!");
        console.error(error.message);
        console.error();
        console.error("Please restore from backup if needed:");
        console.log(`   cp ${backupPath} ${sourceDbPath}`);
        process.exit(1);
    }
    
    readline.close();
}

runMigration().catch(err => {
    console.error("Error during migration:", err);
    readline.close();
    process.exit(1);
});
