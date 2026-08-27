import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import { SROUTER_DIR } from "@srouter/db";
import { formatError, formatInfo, formatSuccess, formatWarning, pc } from "../lib/ui.js";
import { isExecutableInPath } from "../lib/platform.js";

export interface InitCommandOptions {
    mode?: "docker" | "source";
    port?: string;
    dir?: string;
    yes?: boolean;
    detached?: boolean;
}

const DEFAULT_PORT = "3000";
const REPO_URL = "https://github.com/seaavey/SRouter.git";
const DOCKER_IMAGE = "ghcr.io/seaavey/srouter:latest";

function runProcess(
    command: string,
    args: string[],
    options?: { cwd?: string; stdio?: "inherit" | "pipe" }
): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: options?.cwd,
            stdio: options?.stdio ?? "inherit"
        });

        let stdout = "";
        let stderr = "";

        if (options?.stdio === "pipe") {
            child.stdout?.on("data", (d) => (stdout += d.toString()));
            child.stderr?.on("data", (d) => (stderr += d.toString()));
        }

        child.on("close", (code) => {
            resolve({ code: code ?? 0, stdout, stderr });
        });
        child.on("error", (err) => {
            resolve({ code: 1, stdout, stderr: err.message });
        });
    });
}

async function initDocker(port: string, detached: boolean): Promise<void> {
    const s = p.spinner();
    s.start("Checking Docker environment");

    const hasDocker = await isExecutableInPath("docker");
    if (!hasDocker) {
        s.stop(formatError("Docker is not installed or not available in PATH."));
        
        const fallbackChoice = await p.select({
            message: "Docker was not found. What would you like to do?",
            options: [
                {
                    value: "source",
                    label: "Run from Source Code instead (Node.js & pnpm)",
                    hint: "Clones repo and builds locally without Docker"
                },
                {
                    value: "guide",
                    label: "View Docker installation instructions",
                    hint: "Get download link for your OS"
                },
                {
                    value: "exit",
                    label: "Exit",
                    hint: "Cancel initialization"
                }
            ]
        });

        if (p.isCancel(fallbackChoice) || fallbackChoice === "exit") {
            p.outro("Initialization cancelled. Install Docker from https://docs.docker.com/get-docker/ and try again.");
            return;
        }

        if (fallbackChoice === "guide") {
            p.log.message(
                [
                    "📦 " + pc.bold("How to install Docker:"),
                    `• Windows / macOS: ${pc.cyan("https://www.docker.com/products/docker-desktop/")}`,
                    `• Linux (Ubuntu/Debian): ${pc.yellow("curl -fsSL https://get.docker.com | sh")}`,
                    `• Linux (Arch): ${pc.yellow("sudo pacman -S docker && sudo systemctl enable --now docker")}`
                ].join("\n")
            );
            p.outro("Run 'srouter init' again after installing Docker.");
            return;
        }

        if (fallbackChoice === "source") {
            const defaultDir = path.join(os.homedir(), "srouter");
            await initSource(defaultDir, port);
            return;
        }
    }

    s.message("Verifying Docker daemon status");
    const checkDaemon = await runProcess("docker", ["info"], { stdio: "pipe" });
    if (checkDaemon.code !== 0) {
        s.stop(formatError("Docker daemon is not running."));
        p.log.info("Please start the Docker service/daemon and try again.");
        process.exitCode = 1;
        return;
    }

    const dataDir = path.join(SROUTER_DIR, "data");
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

    s.message(`Pulling latest SRouter Docker image (${DOCKER_IMAGE})`);
    const pullRes = await runProcess("docker", ["pull", DOCKER_IMAGE], { stdio: "inherit" });
    if (pullRes.code !== 0) {
        s.stop(formatWarning("Failed to pull image from registry, checking local image cache"));
    }

    // Stop and remove existing container if running
    await runProcess("docker", ["rm", "-f", "srouter"], { stdio: "pipe" });

    s.message(`Starting SRouter Gateway container on port ${port}`);
    const dockerArgs = [
        "run",
        detached ? "-d" : "-it",
        "--name",
        "srouter",
        "--restart",
        "unless-stopped",
        "-p",
        `${port}:3000`,
        "-p",
        "1455:1455",
        "-v",
        `${dataDir}:/app/data`,
        "-e",
        `PORT=${port}`,
        "-e",
        "OAUTH_PORT=1455",
        "-e",
        "DATABASE_PATH=/app/data/srouter.db",
        DOCKER_IMAGE
    ];

    if (detached) {
        const runRes = await runProcess("docker", dockerArgs, { stdio: "pipe" });
        if (runRes.code !== 0) {
            s.stop(formatError("Failed to start SRouter Docker container."));
            p.log.error(runRes.stderr);
            process.exitCode = 1;
            return;
        }
        s.stop(formatSuccess("SRouter Docker container started successfully!"));
        p.log.message(
            [
                `🚀 Gateway URL:  ${pc.bold(pc.cyan(`http://localhost:${port}`))}`,
                `📊 Web Dashboard: ${pc.bold(pc.cyan(`http://localhost:${port}`))}`,
                `💾 Persistent Data: ${pc.dim(dataDir)}`,
                "",
                `To inspect logs: ${pc.yellow("docker logs -f srouter")}`,
                `To stop:         ${pc.yellow("docker stop srouter")}`
            ].join("\n")
        );
        p.outro("SRouter is ready to use!");
    } else {
        s.stop("Launching container in foreground mode...");
        await runProcess("docker", dockerArgs, { stdio: "inherit" });
    }
}

async function initSource(targetDir: string, port: string): Promise<void> {
    const s = p.spinner();

    // Check prerequisites: git, node, pnpm
    s.start("Checking prerequisites (git, node, pnpm)");
    const hasGit = await isExecutableInPath("git");
    const hasPnpm = await isExecutableInPath("pnpm");

    if (!hasGit) {
        s.stop(formatError("Git is required to clone SRouter repository."));
        process.exitCode = 1;
        return;
    }

    const resolvedDir = path.resolve(targetDir);

    // 1. Clone repository if folder doesn't already have package.json
    if (!fs.existsSync(path.join(resolvedDir, "package.json"))) {
        s.message(`Cloning SRouter into ${pc.bold(resolvedDir)}`);
        fs.mkdirSync(resolvedDir, { recursive: true });
        const cloneRes = await runProcess("git", ["clone", REPO_URL, resolvedDir], {
            stdio: "inherit"
        });
        if (cloneRes.code !== 0) {
            s.stop(formatError("Failed to clone SRouter repository."));
            process.exitCode = 1;
            return;
        }
    } else {
        p.log.info(`Using existing SRouter repository at ${pc.bold(resolvedDir)}`);
    }

    // 2. Install dependencies
    s.message("Installing dependencies with pnpm");
    const pnpmCmd = hasPnpm ? "pnpm" : "npx";
    const installArgs = hasPnpm ? ["install"] : ["pnpm", "install"];

    const installRes = await runProcess(pnpmCmd, installArgs, {
        cwd: resolvedDir,
        stdio: "inherit"
    });
    if (installRes.code !== 0) {
        s.stop(formatError("Dependency installation failed."));
        process.exitCode = 1;
        return;
    }

    // 3. Build project
    s.message("Building SRouter packages, API, and Dashboard");
    const buildArgs = hasPnpm ? ["run", "build"] : ["pnpm", "run", "build"];
    const buildRes = await runProcess(pnpmCmd, buildArgs, {
        cwd: resolvedDir,
        stdio: "inherit"
    });
    if (buildRes.code !== 0) {
        s.stop(formatError("Build step failed."));
        process.exitCode = 1;
        return;
    }

    s.stop(formatSuccess("SRouter built successfully!"));

    p.log.message(
        [
            `📁 Project Directory: ${pc.bold(resolvedDir)}`,
            `🚀 Start Dev Server:  ${pc.yellow(`cd ${resolvedDir} && pnpm dev`)}`,
            `⚡ Start Production:  ${pc.yellow(`PORT=${port} cd ${resolvedDir}/apps/api && pnpm start`)}`
        ].join("\n")
    );

    const startNow = await p.confirm({
        message: "Start SRouter API & Web server now?",
        initialValue: true
    });

    if (startNow === true) {
        p.outro(`Starting SRouter Gateway on port ${port}...`);
        process.env.PORT = port;
        const startArgs = hasPnpm
            ? ["--filter", "api", "start"]
            : ["pnpm", "--filter", "api", "start"];
        await runProcess(pnpmCmd, startArgs, {
            cwd: resolvedDir,
            stdio: "inherit"
        });
    } else {
        p.outro("Setup complete! You can start SRouter anytime.");
    }
}

export async function initCommand(options: InitCommandOptions): Promise<void> {
    p.intro(pc.bold(pc.cyan("⚡ SRouter Gateway Initialization")));

    let mode = options.mode;
    if (!mode) {
        const choice = await p.select({
            message: "How would you like to run SRouter?",
            options: [
                {
                    value: "docker",
                    label: "Docker (Recommended)",
                    hint: "Zero-config container with isolated environment & persistent database"
                },
                {
                    value: "source",
                    label: "Source Code (Node.js & pnpm)",
                    hint: "Clone repository, build from source, and run natively"
                }
            ]
        });

        if (p.isCancel(choice)) {
            p.outro("Initialization cancelled.");
            return;
        }
        mode = choice as "docker" | "source";
    }

    let port = options.port;
    if (!port && !options.yes) {
        const inputPort = await p.text({
            message: "Gateway Port:",
            defaultValue: DEFAULT_PORT,
            placeholder: DEFAULT_PORT,
            validate: (val) => {
                const n = Number(val);
                if (Number.isNaN(n) || n <= 0 || n > 65535) {
                    return "Please enter a valid port number (1-65535).";
                }
            }
        });

        if (p.isCancel(inputPort)) {
            p.outro("Initialization cancelled.");
            return;
        }
        port = inputPort || DEFAULT_PORT;
    } else {
        port = port || DEFAULT_PORT;
    }

    if (mode === "docker") {
        const detached = options.detached ?? true;
        await initDocker(port, detached);
    } else {
        const defaultDir = path.join(os.homedir(), "srouter");
        let targetDir = options.dir;
        if (!targetDir && !options.yes) {
            const inputDir = await p.text({
                message: "Target directory for SRouter source code:",
                defaultValue: defaultDir,
                placeholder: defaultDir
            });
            if (p.isCancel(inputDir)) {
                p.outro("Initialization cancelled.");
                return;
            }
            targetDir = inputDir || defaultDir;
        } else {
            targetDir = targetDir || defaultDir;
        }

        await initSource(targetDir, port);
    }
}
