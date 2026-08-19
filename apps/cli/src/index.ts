import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { linkCommand } from "./commands/link.js";
import { unlinkCommand } from "./commands/unlink.js";
import { statusCommand } from "./commands/status.js";
import { envCommand } from "./commands/env.js";
import { runCommand } from "./commands/run.js";

export function createCli(): Command {
    const program = new Command();

    program
        .name("srouter")
        .description(
            "CLI tool to connect, configure, and proxy AI coding tools with SRouter Gateway"
        )
        .version("0.1.1-rc.1");

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

    return program;
}

if (
    process.argv[1]?.endsWith("srouter.js") ||
    process.argv[1]?.endsWith("index.ts") ||
    process.argv[1]?.endsWith("index.js")
) {
    const program = createCli();
    program.parse(process.argv);
}
