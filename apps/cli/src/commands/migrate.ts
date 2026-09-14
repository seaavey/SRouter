import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as p from "@clack/prompts";
import { DatabaseSync } from "node:sqlite";
import { getDatabasePath, initDatabase, LEGACY_DB_LOCATIONS } from "@srouter/db";
import { formatError, formatInfo, formatSuccess, formatWarning, pc } from "../lib/ui.js";

type SqliteValue = string | number | bigint | Uint8Array | null;

interface NineRouterJsonBackup {
    settings?: Record<string, unknown>;
    providerConnections?: Array<{
        id: string;
        provider: string;
        name: string;
        authType?: string;
        apiKey?: string;
        accessToken?: string;
        access_token?: string;
        refreshToken?: string;
        refresh_token?: string;
        expiresAt?: string;
        tokenExpiresAt?: number;
        lastRefreshAt?: string;
        lastRefreshedAt?: number;
        providerSpecificData?: Record<string, unknown>;
        isActive?: boolean;
        createdAt?: string;
        updatedAt?: string;
        [key: string]: unknown;
    }>;
    providerNodes?: Array<{
        id: string;
        name: string;
        prefix?: string;
        apiType?: string;
        baseUrl?: string;
        type?: string;
        [key: string]: unknown;
    }>;
    apiKeys?: Array<{
        id?: string;
        key: string;
        name?: string;
        isActive?: boolean;
        createdAt?: string;
        [key: string]: unknown;
    }>;
    customModels?: Array<{
        providerAlias?: string;
        id: string;
        type?: string;
        name?: string;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
}

function parseDateToTimestamp(val: unknown): number {
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (typeof val === "string") {
        const parsed = Date.parse(val);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return Date.now();
}

function map9RouterProtocol(apiType?: string, type?: string): string {
    if (apiType === "anthropic" || type === "anthropic" || type?.includes("anthropic")) {
        return "anthropic";
    }
    return "openai";
}

function importNineRouterJson(
    data: NineRouterJsonBackup,
    targetDb: DatabaseSync,
    action: "copy" | "merge" | "backup_and_replace"
): { inserted: number; skipped: number; tablesCount: number } {
    const nodesMap = new Map<string, NonNullable<NineRouterJsonBackup["providerNodes"]>[number]>();
    if (Array.isArray(data.providerNodes)) {
        for (const node of data.providerNodes) {
            nodesMap.set(node.id, node);
        }
    }

    if (action !== "copy") {
        try {
            targetDb.prepare('DELETE FROM "providers"').run();
            targetDb.prepare('DELETE FROM "api_keys"').run();
            targetDb.prepare('DELETE FROM "custom_models"').run();
        } catch {
            // Ignored if table doesn't exist
        }
    }

    let inserted = 0;
    let skipped = 0;
    let tablesCount = 0;

    // 1. Migrate Providers
    if (Array.isArray(data.providerConnections) && data.providerConnections.length > 0) {
        tablesCount++;
        const insertProvider = targetDb.prepare(`
            INSERT OR REPLACE INTO providers (
                id, provider_id, name, category, protocol, base_url, api_key, access_token,
                refresh_token, account_id, organization_id, token_expires_at, last_refreshed_at,
                custom_headers, provider_specific_data, enabled, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const conn of data.providerConnections) {
            try {
                const node = nodesMap.get(conn.provider);
                const providerId = node ? node.name.toLowerCase() : conn.provider;
                const protocol = node ? map9RouterProtocol(node.apiType, node.type) : "openai";
                const baseUrl =
                    node?.baseUrl ?? (conn.providerSpecificData?.baseUrl as string) ?? null;
                const apiKey = conn.apiKey ?? null;
                const accessToken = conn.accessToken ?? conn.access_token ?? null;
                const refreshToken = conn.refreshToken ?? conn.refresh_token ?? null;

                const tokenExpiresAt =
                    conn.tokenExpiresAt ??
                    (conn.expiresAt ? parseDateToTimestamp(conn.expiresAt) : null);
                const lastRefreshedAt =
                    conn.lastRefreshedAt ??
                    (conn.lastRefreshAt ? parseDateToTimestamp(conn.lastRefreshAt) : null);

                const accountId =
                    (conn.providerSpecificData?.chatgptAccountId as string) ??
                    (conn.providerSpecificData?.accountId as string) ??
                    null;
                const orgId = (conn.providerSpecificData?.organizationId as string) ?? null;
                const enabled = conn.isActive === false ? 0 : 1;
                const createdAt = parseDateToTimestamp(conn.createdAt);

                insertProvider.run(
                    conn.id,
                    providerId,
                    conn.name || providerId,
                    "general",
                    protocol,
                    baseUrl,
                    apiKey,
                    accessToken,
                    refreshToken,
                    accountId,
                    orgId,
                    tokenExpiresAt,
                    lastRefreshedAt,
                    null,
                    conn.providerSpecificData ? JSON.stringify(conn.providerSpecificData) : null,
                    enabled,
                    createdAt
                );
                inserted++;
            } catch {
                skipped++;
            }
        }
    }

    // 2. Migrate API Keys
    if (Array.isArray(data.apiKeys) && data.apiKeys.length > 0) {
        tablesCount++;
        const insertKey = targetDb.prepare(`
            INSERT OR REPLACE INTO api_keys (
                id, key, name, enabled, rate_limit, quota_limit, usage_tokens, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const keyItem of data.apiKeys) {
            try {
                insertKey.run(
                    keyItem.id || `key_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    keyItem.key,
                    keyItem.name || "Default Key",
                    keyItem.isActive === false ? 0 : 1,
                    0,
                    0,
                    0,
                    parseDateToTimestamp(keyItem.createdAt)
                );
                inserted++;
            } catch {
                skipped++;
            }
        }
    }

    // 3. Migrate Custom Models
    if (Array.isArray(data.customModels) && data.customModels.length > 0) {
        tablesCount++;
        const insertCustomModel = targetDb.prepare(`
            INSERT OR IGNORE INTO custom_models (
                provider_id, model_id, created_at
            ) VALUES (?, ?, ?)
        `);

        for (const model of data.customModels) {
            try {
                insertCustomModel.run(
                    model.providerAlias || "default",
                    model.id || model.name || "unknown",
                    Date.now()
                );
                inserted++;
            } catch {
                skipped++;
            }
        }
    }

    return { inserted, skipped, tablesCount };
}

export interface MigrateCommandOptions {
    source?: string;
    yes?: boolean;
    action?: "copy" | "merge" | "backup_and_replace";
}

/** Resolved lazily (not at import) so tests can redirect via `DATABASE_PATH`
 * to an isolated file instead of the production database. */
function getTargetDbPath(): string {
    return getDatabasePath();
}

/** Backups live next to the target database (isolated automatically in tests). */
function getBackupDir(targetDbPath: string): string {
    return path.join(path.dirname(targetDbPath), "backups");
}

const NineRouterDbLocations = [
    path.join(os.homedir(), ".9router", "srouter.db"),
    path.join(os.homedir(), ".9router", "9router.db"),
    path.join(os.homedir(), "9router", "srouter.db"),
    path.join(os.homedir(), "9router", "data.db"),
    path.join(os.homedir(), "9router", "db", "srouter.db"),
    path.join(os.homedir(), ".config", "9router", "srouter.db"),
    path.join(os.homedir(), ".config", "9router", "9router.db"),
    "/root/9router/srouter.db",
    "/root/project/9router/db/srouter.db",
    ...LEGACY_DB_LOCATIONS
];

function fileKb(filePath: string): string {
    return `${(fs.statSync(filePath).size / 1024).toFixed(2)} KB`;
}

function ensureDirs(targetDbPath: string): void {
    fs.mkdirSync(path.dirname(targetDbPath), { recursive: true, mode: 0o700 });
    fs.mkdirSync(getBackupDir(targetDbPath), { recursive: true, mode: 0o755 });
}

function backupDb(source: string, label: string, targetDbPath: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(getBackupDir(targetDbPath), `${label}-backup-${timestamp}.db`);
    fs.copyFileSync(source, backupPath);
    p.log.step(`Backed up to ${pc.dim(backupPath)}`);
    return backupPath;
}

function getDownloadDirs(): string[] {
    const home = os.homedir();
    const dirs = [
        path.join(home, "Downloads"),
        path.join(home, "download"),
        path.join(home, "downloads"),
        path.join(home, "Desktop")
    ];

    if (process.platform === "win32") {
        if (process.env.USERPROFILE) {
            dirs.push(path.join(process.env.USERPROFILE, "Downloads"));
            dirs.push(path.join(process.env.USERPROFILE, "Desktop"));
        }
    }

    return Array.from(new Set(dirs.filter((d) => fs.existsSync(d))));
}

export function scanFor9RouterFiles(): Array<{ path: string; label: string; mtime: number }> {
    const results: Array<{ path: string; label: string; mtime: number }> = [];
    const seen = new Set<string>();

    const addFile = (filePath: string, label: string) => {
        const resolved = path.resolve(filePath);
        if (!seen.has(resolved) && fs.existsSync(resolved)) {
            try {
                const stat = fs.statSync(resolved);
                if (stat.isFile()) {
                    seen.add(resolved);
                    results.push({ path: resolved, label, mtime: stat.mtimeMs });
                }
            } catch {
                // Ignore inaccessible files
            }
        }
    };

    // 1. Scan default App/DB locations
    for (const loc of NineRouterDbLocations) {
        addFile(loc, "Installed Database");
    }

    // 2. Scan Downloads and Desktop folders for 9router backup JSON and DB files
    for (const downloadDir of getDownloadDirs()) {
        try {
            const files = fs.readdirSync(downloadDir);
            for (const file of files) {
                const lower = file.toLowerCase();
                const fullPath = path.join(downloadDir, file);
                if (
                    lower.includes("9router") ||
                    lower.includes("srouter-backup") ||
                    lower.endsWith(".db") ||
                    (lower.endsWith(".json") && lower.includes("backup"))
                ) {
                    addFile(fullPath, path.basename(downloadDir));
                }
            }
        } catch {
            // Ignore unreadable directory
        }
    }

    return results.sort((a, b) => b.mtime - a.mtime);
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
    const targetDbPath = getTargetDbPath();

    if (fs.existsSync(targetDbPath)) {
        p.log.warn(`Database already exists at ${targetDbPath} (${fileKb(targetDbPath)})`);
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
            `Start SRouter and a fresh database will be created at ${targetDbPath}, ` +
                "or pass --source /path/to/srouter.db."
        );
        return;
    }

    ensureDirs(targetDbPath);
    const proceed =
        options.yes || (await p.confirm({ message: `Migrate database from ${source}?` })) === true;

    if (!proceed) {
        p.outro("Migration cancelled.");
        return;
    }

    try {
        backupDb(source, "srouter", targetDbPath);
        fs.copyFileSync(source, targetDbPath);
        fs.chmodSync(targetDbPath, 0o600);
        p.log.success(`Database moved to ${targetDbPath}`);
        p.outro("Restart SRouter to use the migrated database.");
    } catch (error) {
        p.log.error(formatError(`Migration failed: ${(error as Error).message}`));
        process.exitCode = 1;
    }
}

async function migrateNineRouter(options: MigrateCommandOptions): Promise<void> {
    p.intro("9Router → SRouter Database Migration");

    let source =
        options.source && fs.existsSync(options.source) ? path.resolve(options.source) : null;

    if (!source) {
        const foundFiles = scanFor9RouterFiles();

        if (foundFiles.length === 1) {
            source = foundFiles[0].path;
            p.log.info(
                `Found 9Router file: ${pc.bold(source)} (${fileKb(source)}) [${foundFiles[0].label}]`
            );
        } else if (foundFiles.length > 1) {
            if (options.yes) {
                source = foundFiles[0].path;
                p.log.info(
                    `Auto-selected latest 9Router file: ${pc.bold(source)} (${fileKb(source)})`
                );
            } else {
                const choice = await p.select({
                    message: "Multiple 9Router database/backup files found. Select one to migrate:",
                    options: [
                        ...foundFiles.map((f) => ({
                            value: f.path,
                            label: `${path.basename(f.path)} (${fileKb(f.path)})`,
                            hint: `${f.label} • ${f.path}`
                        })),
                        { value: "custom", label: "Enter custom path manually..." }
                    ]
                });

                if (p.isCancel(choice)) {
                    p.outro("Migration cancelled.");
                    return;
                }

                if (choice === "custom") {
                    const customPath = await p.text({
                        message: "Enter path to 9Router .db or .json backup file:",
                        validate: (val) => {
                            if (!val || !fs.existsSync(path.resolve(val))) {
                                return "File does not exist. Please check the path.";
                            }
                        }
                    });
                    if (p.isCancel(customPath) || !customPath) {
                        p.outro("Migration cancelled.");
                        return;
                    }
                    source = path.resolve(customPath);
                } else {
                    source = choice as string;
                }
            }
        }
    }

    if (!source) {
        p.log.error("No 9Router database or backup file found.");
        p.outro(
            "Pass the location explicitly: srouter migrate 9router --source /path/to/9router-backup.json"
        );
        process.exitCode = 1;
        return;
    }

    const targetDbPath = getTargetDbPath();
    const existingTarget = fs.existsSync(targetDbPath);
    let action: "copy" | "merge" | "backup_and_replace" = options.action ?? "copy";

    if (existingTarget && !options.action) {
        if (options.yes) {
            action = "merge";
        } else {
            p.log.warn(
                `Existing SRouter database found at ${targetDbPath} (${fileKb(targetDbPath)})`
            );
            const choice = await p.select({
                message: "How should the existing SRouter database be handled?",
                options: [
                    {
                        value: "backup_and_replace",
                        label: "Backup current, replace with 9Router data"
                    },
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
    }

    const proceed =
        options.yes || (await p.confirm({ message: "Proceed with migration?" })) === true;
    if (!proceed) {
        p.outro("Migration cancelled. No changes made.");
        return;
    }

    ensureDirs(targetDbPath);
    const sourceBackup = backupDb(source, "9router", targetDbPath);

    let targetBackup: string | null = null;
    if (action === "backup_and_replace") {
        targetBackup = backupDb(targetDbPath, "srouter", targetDbPath);
    }

    const s = p.spinner();
    try {
        s.start("Preparing target database");
        await initDatabase();

        const targetDb = new DatabaseSync(targetDbPath);
        targetDb.exec("PRAGMA foreign_keys = OFF;");

        let inserted = 0;
        let skipped = 0;
        let tablesCount = 0;

        const isJson = source.endsWith(".json");
        if (isJson) {
            s.message("Reading 9Router JSON backup");
            const raw = fs.readFileSync(source, "utf-8");
            const parsed = JSON.parse(raw) as NineRouterJsonBackup;
            const res = importNineRouterJson(parsed, targetDb, action);
            inserted = res.inserted;
            skipped = res.skipped;
            tablesCount = res.tablesCount;
        } else {
            const sourceDb = new DatabaseSync(source);
            s.message("Reading source SQLite tables");

            const sourceTables = (
                sourceDb
                    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                    .all() as Array<{ name: string }>
            )
                .map((t) => t.name)
                .filter((name) => !name.startsWith("sqlite_"));

            const targetTables = new Set(
                (
                    targetDb
                        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
                        .all() as Array<{ name: string }>
                ).map((t) => t.name)
            );

            for (const table of sourceTables) {
                if (!targetTables.has(table)) {
                    p.log.warn(`Skipping table ${table} (not recognized by SRouter)`);
                    continue;
                }

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

                const sourceColumns = new Set(
                    (
                        sourceDb.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
                            name: string;
                        }>
                    ).map((col) => col.name)
                );

                const targetColumns = (
                    targetDb.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
                        name: string;
                    }>
                )
                    .map((col) => col.name)
                    .filter((col) => sourceColumns.has(col));

                if (targetColumns.length === 0) continue;

                const placeholders = targetColumns.map(() => "?").join(", ");
                const insert = targetDb.prepare(
                    `INSERT OR REPLACE INTO "${table}" (${targetColumns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`
                );

                for (const row of rows) {
                    try {
                        insert.run(...targetColumns.map((col) => row[col] ?? null));
                        inserted++;
                    } catch {
                        skipped++;
                    }
                }
                tablesCount++;
            }

            sourceDb.close();
        }

        targetDb.exec("PRAGMA foreign_keys = ON;");
        targetDb.close();
        s.stop("Migration complete");

        p.log.message(
            [
                `Tables/Categories migrated: ${tablesCount}`,
                `Rows/Items inserted: ${inserted}`,
                `Rows/Items skipped: ${skipped}`,
                `Source: ${source}`,
                `Target: ${targetDbPath}`
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
