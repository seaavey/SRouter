import { Command } from "commander";
import { CLI_VERSION } from "@srouter/constants";
import { setupCommand } from "./commands/setup.js";
import { initCommand } from "./commands/init.js";
import { linkCommand } from "./commands/link.js";
import { unlinkCommand } from "./commands/unlink.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { envCommand } from "./commands/env.js";
import { runCommand } from "./commands/run.js";
import { migrateCommand } from "./commands/migrate.js";

export function createCli(): Command {
    const program = new Command();

    program
        .name("srouter")
        .description(
            "CLI tool to connect, configure, and proxy AI coding tools with SRouter Gateway"
        )
        .version(CLI_VERSION);

    program
        .command("setup")
        .alias("config")
        .description(
            "Interactive wizard to connect AI coding tools (Claude Code, OpenCode) to SRouter"
        )
        .option("-u, --url <url>", "SRouter Gateway Base URL (e.g. http://localhost:3000/v1)")
        .option("-k, --key <key>", "SRouter API Key")
        .option("-m, --model <model>", "Default model ID to configure")
        .option(
            "--opus-model <model>",
            "Default Opus tier model for Claude Code (ANTHROPIC_DEFAULT_OPUS_MODEL)"
        )
        .option(
            "--sonnet-model <model>",
            "Default Sonnet tier model for Claude Code (ANTHROPIC_DEFAULT_SONNET_MODEL)"
        )
        .option(
            "--haiku-model <model>",
            "Default Haiku tier model for Claude Code (ANTHROPIC_DEFAULT_HAIKU_MODEL)"
        )
        .action(async (opts) => {
            await setupCommand(opts);
        });

    program
        .command("init")
        .description("Initialize and run SRouter Gateway (Docker container or Source Code)")
        .option("-m, --mode <mode>", "Run mode (docker or source)")
        .option("-p, --port <port>", "Gateway port (default: 3000)")
        .option("-d, --dir <dir>", "Source code clone directory (default: ~/srouter)")
        .option("-y, --yes", "Accept default values without interactive prompt")
        .option("--detached", "Run docker container in background (default: true)")
        .action(async (opts) => {
            await initCommand(opts);
        });

    program
        .command("link <tool>")
        .description("Configure a specific tool to use SRouter proxy (claude, opencode)")
        .option("-u, --url <url>", "SRouter Gateway Base URL (e.g. http://localhost:3000/v1)")
        .option("-k, --key <key>", "SRouter API Key")
        .option("-m, --model <model>", "Model ID")
        .option(
            "--opus-model <model>",
            "Opus tier model ID for Claude Code (ANTHROPIC_DEFAULT_OPUS_MODEL)"
        )
        .option(
            "--sonnet-model <model>",
            "Sonnet tier model ID for Claude Code (ANTHROPIC_DEFAULT_SONNET_MODEL)"
        )
        .option(
            "--haiku-model <model>",
            "Haiku tier model ID for Claude Code (ANTHROPIC_DEFAULT_HAIKU_MODEL)"
        )
        .option("--dry-run", "Preview configuration changes without writing files")
        .action(async (tool, opts) => {
            await linkCommand(tool, opts);
        });

    program
        .command("unlink <tool>")
        .description("Restore original configuration for a tool from backup")
        .action(async (tool) => {
            await unlinkCommand(tool);
        });

    program
        .command("sync [tool]")
        .description(
            "Fetch latest models from SRouter Gateway and refresh tool configs (OpenCode, etc.)"
        )
        .option("-u, --url <url>", "SRouter Gateway Base URL (e.g. http://localhost:3000/v1)")
        .option("-k, --key <key>", "SRouter API Key")
        .action(async (tool, opts) => {
            await syncCommand(tool, opts);
        });

    program
        .command("status")
        .alias("doctor")
        .description("Inspect SRouter gateway connectivity, active models, and tool link status")
        .option("-u, --url <url>", "SRouter Gateway Base URL (e.g. http://localhost:3000/v1)")
        .option("-k, --key <key>", "SRouter API Key")
        .action(async (opts) => {
            await statusCommand(opts);
        });

    program
        .command("env [tool]")
        .description("Print shell export commands for SRouter proxy environment variables")
        .option("-u, --url <url>", "SRouter Gateway Base URL (e.g. http://localhost:3000/v1)")
        .option("-k, --key <key>", "SRouter API Key")
        .option("-m, --model <model>", "Model ID")
        .option(
            "--opus-model <model>",
            "Opus tier model ID for Claude Code (ANTHROPIC_DEFAULT_OPUS_MODEL)"
        )
        .option(
            "--sonnet-model <model>",
            "Sonnet tier model ID for Claude Code (ANTHROPIC_DEFAULT_SONNET_MODEL)"
        )
        .option(
            "--haiku-model <model>",
            "Haiku tier model ID for Claude Code (ANTHROPIC_DEFAULT_HAIKU_MODEL)"
        )
        .option("--fish", "Generate fish shell export syntax (shorthand for --shell fish)")
        .option("--shell <shell>", "Target shell syntax (bash, zsh, fish, powershell, cmd)")
        .action(async (tool, opts) => {
            await envCommand(tool, opts);
        });

    program
        .command("run <tool> [args...]")
        .description("Run a tool CLI directly with SRouter proxy environment variables injected")
        .option("-u, --url <url>", "SRouter Gateway Base URL (e.g. http://localhost:3000/v1)")
        .option("-k, --key <key>", "SRouter API Key")
        .option("-m, --model <model>", "Model ID")
        .option(
            "--opus-model <model>",
            "Opus tier model ID for Claude Code (ANTHROPIC_DEFAULT_OPUS_MODEL)"
        )
        .option(
            "--sonnet-model <model>",
            "Sonnet tier model ID for Claude Code (ANTHROPIC_DEFAULT_SONNET_MODEL)"
        )
        .option(
            "--haiku-model <model>",
            "Haiku tier model ID for Claude Code (ANTHROPIC_DEFAULT_HAIKU_MODEL)"
        )
        .allowUnknownOption()
        .action(async (tool, args, opts) => {
            await runCommand(tool, args, opts);
        });

    program
        .command("migrate <target>")
        .description("Migrate databases (targets: db = legacy location, 9router = 9Router import)")
        .option("--source <path>", "Explicit path to the source SQLite database")
        .option("-y, --yes", "Skip confirmation prompts")
        .option("-a, --action <action>", "Migration conflict resolution (copy, merge, backup_and_replace)")
        .action(async (target, opts) => {
            await migrateCommand(target, opts);
        });

    return program;
}

function runCli(): void {
    const isEntrypoint =
        process.argv[1]?.endsWith("srouter.js") ||
        process.argv[1]?.endsWith("index.js") ||
        process.argv[1]?.endsWith("index.ts") ||
        process.argv[1]?.includes("/.bin/srouter") ||
        process.argv[1]?.includes("/bin/srouter");

    if (isEntrypoint) {
        const program = createCli();
        program.parse(process.argv);
    }
}

runCli();


