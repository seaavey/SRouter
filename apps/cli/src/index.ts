import { Command } from "commander";
import { setupCommand } from "./commands/setup.ts";
import { linkCommand } from "./commands/link.ts";
import { unlinkCommand } from "./commands/unlink.ts";
import { statusCommand } from "./commands/status.ts";
import { envCommand } from "./commands/env.ts";
import { runCommand } from "./commands/run.ts";

export function createCli(): Command {
    const program = new Command();

    program
        .name("srouter")
        .description("CLI tool to configure and link AI coding tools to SRouter")
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
        .action(async (opts) => {
            await setupCommand(opts);
        });

    program
        .command("link <tool>")
        .description("Configure a specific tool to use SRouter proxy (claude, opencode)")
        .option("-u, --url <url>", "SRouter Gateway Base URL")
        .option("-k, --key <key>", "SRouter API Key")
        .option("-m, --model <model>", "Model ID")
        .option("--dry-run", "Simulate without writing files")
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
        .description("Inspect SRouter server connectivity and tool integration status")
        .option("-u, --url <url>", "SRouter Gateway Base URL")
        .option("-k, --key <key>", "SRouter API Key")
        .action(async (opts) => {
            await statusCommand(opts);
        });

    program
        .command("env [tool]")
        .description("Print shell export commands for SRouter proxy environment variables")
        .option("-u, --url <url>", "SRouter Gateway Base URL")
        .option("-k, --key <key>", "SRouter API Key")
        .option("-m, --model <model>", "Model ID")
        .option("--fish", "Generate fish shell export syntax")
        .action(async (tool, opts) => {
            await envCommand(tool, opts);
        });

    program
        .command("run <tool> [args...]")
        .description("Run a tool CLI with SRouter environment variables injected on the fly")
        .option("-u, --url <url>", "SRouter Gateway Base URL")
        .option("-k, --key <key>", "SRouter API Key")
        .option("-m, --model <model>", "Model ID")
        .allowUnknownOption()
        .action(async (tool, args, opts) => {
            await runCommand(tool, args, opts);
        });

    return program;
}

if (process.argv[1]?.endsWith("srouter.js") || process.argv[1]?.endsWith("index.ts")) {
    const program = createCli();
    program.parse(process.argv);
}
