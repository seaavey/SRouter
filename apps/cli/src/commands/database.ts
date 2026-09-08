import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import {
    exportDatabaseSnapshot,
    replaceDatabaseFromFile,
    validateDatabaseImport,
    type DatabaseTransferExportResult
} from "@srouter/db";
import { formatError } from "../lib/ui.js";

interface ExportOptions {
    force?: boolean;
}

interface ImportOptions {
    yes?: boolean;
}

function defaultExportPath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.resolve(process.cwd(), `srouter-export-${timestamp}.db`);
}

function displayExportResult(result: DatabaseTransferExportResult): void {
    p.log.success(`Database exported to ${result.path} (${result.size} bytes).`);
    p.log.warn("The export contains provider credentials and API keys as plaintext data.");
}

async function exportCommand(output: string | undefined, options: ExportOptions): Promise<void> {
    const outputPath = path.resolve(output ?? defaultExportPath());
    if (fs.existsSync(outputPath) && !options.force) {
        p.log.error(formatError(`Export path already exists: ${outputPath}. Use --force to overwrite it.`));
        process.exitCode = 1;
        return;
    }

    try {
        displayExportResult(exportDatabaseSnapshot(outputPath));
    } catch (error) {
        p.log.error(formatError(error instanceof Error ? error.message : "Database export failed."));
        process.exitCode = 1;
    }
}

async function importCommand(input: string, options: ImportOptions): Promise<void> {
    const inputPath = path.resolve(input);
    if (!fs.existsSync(inputPath)) {
        p.log.error(formatError(`Import file does not exist: ${inputPath}`));
        process.exitCode = 1;
        return;
    }

    p.log.warn("Database import replaces all target data and includes credentials in plaintext.");
    if (!options.yes) {
        const confirmed = await p.confirm({
            message: "Replace the local SRouter database with this file? All current data will be replaced."
        });
        if (p.isCancel(confirmed) || confirmed !== true) {
            p.log.info("Database import cancelled. No changes made.");
            return;
        }
    }

    try {
        validateDatabaseImport(inputPath);
        const result = replaceDatabaseFromFile(inputPath);
        p.log.success(`Database imported from ${inputPath}.`);
        p.log.info(`Current database backup: ${result.backupPath}`);
        if (result.restartRequired) {
            p.log.warn("Restart SRouter to finish applying the imported database.");
        }
    } catch (error) {
        p.log.error(formatError(error instanceof Error ? error.message : "Database import failed."));
        process.exitCode = 1;
    }
}

export function databaseCommand(): Command {
    const command = new Command("db");
    command.description("Export and replace the local SRouter SQLite database");
    command
        .command("export [path]")
        .description("Export a consistent local SQLite snapshot")
        .option("-f, --force", "Overwrite an existing export file")
        .action(exportCommand);
    command
        .command("import <path>")
        .description("Replace the local database from a SQLite snapshot")
        .option("-y, --yes", "Skip the destructive replacement confirmation")
        .action(importCommand);
    return command;
}
