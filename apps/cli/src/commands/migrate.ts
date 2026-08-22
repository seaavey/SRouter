import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_DB_PATH, LEGACY_DB_LOCATIONS, SROUTER_DIR } from "@srouter/db";
import { formatError, formatInfo, formatSuccess, formatWarning, pc } from "../lib/ui.js";

type SqliteValue = string | number | bigint | Uint8Array | null;

export interface MigrateCommandOptions {
    source?: string;
    yes?: boolean;
}

const TargetDbPath = DEFAULT_DB_PATH;
const BackupDir = path.join(SROUTER_DIR, "backups");

const NineRouterDbLocations = [
    "/root/9router/srouter.db",
    "/root/project/9router/db/srouter.db",
    ...LEGACY_DB_LOCATIONS
];

function fileKb(filePath: string): string {
    return `${(fs.statSync(filePath).size / 1024).toFixed(2)} KB`;
}

function ensureDirs(): void {
    fs.mkdirSync(SROUTER_DIR, { recursive: true, mode: 0o700 });
    fs.mkdirSync(BackupDir, { recursive: true, mode: 0o755 });
}

function backupDb(source: string, label: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(BackupDir, `${label}-backup-${timestamp}.db`);
    fs.copyFileSync(source, backupPath);
    p.log.step(`Backed up to ${pc.dim(backupPath)}`);
    return backupPath;
}

function findDatabase(candidates: string[], label: string): string | null {
    for (const candidate of candidates) {
        const fullPath = path.resolve(candidate);
        if (fs.existsSync(fullPath)) {
            p.log.info(`Found ${label} database: ${pc.bold(fullPath)} (${fileKb(fullPath)})`);
            return fullPath;
        }
    }
    return null;
}

async function migrateDb(options: MigrateCommandOptions): Promise<void> {
    p.intro("SRouter Database Migration");

    if (fs.existsSync(TargetDbPath)) {
        p.log.warn(`Database already exists at ${TargetDbPath} (${fileKb(TargetDbPath)})`);
        p.outro("No migration needed — already using the new location.");
        return;
    }

    const source =
        options.source && fs.existsSync(options.source)
            ? path.resolve(options.source)
            : findDatabase(LEGACY_DB_LOCATIONS, "legacy");

    if (!source) {
        p.log.error("No existing database found.");
        p.outro(
            `Start SRouter and a fresh database will be created at ${TargetDbPath}, ` +
                "or pass --source /path/to/srouter.db."
        );
        return;
    }

    ensureDirs();
    const proceed =
        options.yes || (await p.confirm({ message: `Migrate database from ${source}?` })) === true;

    if (!proceed) {
        p.outro("Migration cancelled.");
        return;
    }

    try {
        backupDb(source, "srouter");
        fs.copyFileSync(source, TargetDbPath);
        fs.chmodSync(TargetDbPath, 0o600);
        p.log.success(`Database moved to ${TargetDbPath}`);
        p.outro("Restart SRouter to use the migrated database.");
    } catch (error) {
        p.log.error(formatError(`Migration failed: ${(error as Error).message}`));
        process.exitCode = 1;
    }
}

async function migrateNineRouter(options: MigrateCommandOptions): Promise<void> {
    p.intro("9Router → SRouter Database Migration");

    const source =
        options.source && fs.existsSync(options.source)
            ? path.resolve(options.source)
            : findDatabase(NineRouterDbLocations, "9Router");

    if (!source) {
        p.log.error("No 9Router database found.");
        p.outro(
            "Pass the location explicitly: srouter migrate 9router --source /path/to/9router.db"
        );
        process.exitCode = 1;
        return;
    }

    const existingTarget = fs.existsSync(TargetDbPath);
    let action: "copy" | "merge" | "backup_and_replace" = "copy";

    if (existingTarget) {
        p.log.warn(`Existing SRouter database found at ${TargetDbPath} (${fileKb(TargetDbPath)})`);
        const choice = await p.select({
            message: "How should the existing SRouter database be handled?",
            options: [
                { value: "backup_and_replace", label: "Backup current, replace with 9Router data" },
                { value: "merge", label: "Overwrite tables with 9Router data" },
                { value: "abort", label: "Cancel migration" }
            ]
        });
        if (choice === "abort" || p.isCancel(choice)) {
            p.outro("Migration cancelled. Your 9Router installation remains intact.");
            return;
        }
        if (choice === "merge" || choice === "backup_and_replace") {
            action = choice;
        }
    }

    const proceed =
        options.yes || (await p.confirm({ message: "Proceed with migration?" })) === true;
    if (!proceed) {
        p.outro("Migration cancelled. No changes made.");
        return;
    }

    ensureDirs();
    const sourceBackup = backupDb(source, "9router");

    let targetBackup: string | null = null;
    if (action === "backup_and_replace") {
        targetBackup = backupDb(TargetDbPath, "srouter");
    }

    const s = p.spinner();
    try {
        s.start("Opening databases");
        const sourceDb = new DatabaseSync(source);
        const targetDb = new DatabaseSync(TargetDbPath);
        s.message("Reading source tables");

        const tables = (
            sourceDb
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .all() as Array<{ name: string }>
        ).map((t) => t.name);

        let inserted = 0;
        let skipped = 0;

        for (const table of tables) {
            const rows = sourceDb.prepare(`SELECT * FROM "${table}"`).all() as Record<
                string,
                SqliteValue
            >[];
            if (rows.length === 0) continue;

            if (action !== "copy") {
                try {
                    targetDb.prepare(`DELETE FROM "${table}"`).run();
                } catch {
                    p.log.warn(`Could not clear table ${table}, rows will be appended`);
                }
            }

            const columns = (
                sourceDb.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
                    name: string;
                }>
            ).map((col) => col.name);
            const placeholders = columns.map(() => "?").join(", ");
            const insert = targetDb.prepare(
                `INSERT INTO "${table}" (${columns.join(", ")}) VALUES (${placeholders})`
            );

            for (const row of rows) {
                try {
                    insert.run(...columns.map((col) => row[col]));
                    inserted++;
                } catch {
                    skipped++;
                }
            }
        }

        sourceDb.close();
        targetDb.close();
        s.stop("Migration complete");

        p.log.message(
            [
                `Tables migrated: ${tables.length}`,
                `Rows inserted: ${inserted}`,
                `Rows skipped: ${skipped}`,
                `Source: ${source}`,
                `Target: ${TargetDbPath}`
            ].join("\n")
        );

        if (targetBackup) {
            p.log.info(`Old SRouter database backed up to ${targetBackup}`);
        }
        p.log.success(formatSuccess(`9Router backup saved to ${sourceBackup}`));
        p.outro("Your 9Router providers are now available in SRouter.");
    } catch (error) {
        s.stop(formatError("Migration failed"));
        p.log.error((error as Error).message);
        p.log.info(formatInfo(`Restore from backup if needed: cp ${sourceBackup} ${source}`));
        process.exitCode = 1;
    }
}

export async function migrateCommand(
    target: string,
    options: MigrateCommandOptions
): Promise<void> {
    switch (target) {
        case "db":
            return migrateDb(options);
        case "9router":
            return migrateNineRouter(options);
        default:
            p.log.error(formatError(`Unknown migration target: ${target}`));
            p.log.info(
                formatWarning("Available targets: db (legacy location), 9router (9Router import)")
            );
            process.exitCode = 1;
    }
}
