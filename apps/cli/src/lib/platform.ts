import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type PlatformType = "windows" | "macos" | "linux" | "unknown";
export type ShellType = "bash" | "zsh" | "fish" | "powershell" | "cmd";

export interface SystemInfo {
    platform: PlatformType;
    osType: string;
    osRelease: string;
    arch: string;
    displayName: string;
    homeDir: string;
    detectedShell: ShellType;
}

export function getPlatform(): PlatformType {
    const p = process.platform;
    if (p === "win32") return "windows";
    if (p === "darwin") return "macos";
    if (p === "linux") return "linux";
    return "unknown";
}

export function isWindows(): boolean {
    return process.platform === "win32";
}

export function isMacOS(): boolean {
    return process.platform === "darwin";
}

export function isLinux(): boolean {
    return process.platform === "linux";
}

export function getOsDisplayName(): string {
    const p = getPlatform();
    const arch = os.arch();
    const rel = os.release();

    switch (p) {
        case "macos":
            return `macOS (${arch === "arm64" ? "Apple Silicon" : arch}) [Darwin ${rel}]`;
        case "windows":
            return `Windows (${arch}) [NT ${rel}]`;
        case "linux":
            return `Linux (${arch}) [${rel}]`;
        default:
            return `${process.platform} (${arch})`;
    }
}

export function detectShell(): ShellType {
    const shellEnv = process.env.SHELL?.toLowerCase() || "";
    if (shellEnv.includes("fish")) return "fish";
    if (shellEnv.includes("zsh")) return "zsh";
    if (shellEnv.includes("bash")) return "bash";

    if (isWindows()) {
        if (process.env.PSModulePath || process.env.POWERSHELL_DISTRIBUTION_CHANNEL) {
            return "powershell";
        }
        return "cmd";
    }

    return "bash";
}

export function getSystemInfo(): SystemInfo {
    return {
        platform: getPlatform(),
        osType: os.type(),
        osRelease: os.release(),
        arch: os.arch(),
        displayName: getOsDisplayName(),
        homeDir: os.homedir(),
        detectedShell: detectShell()
    };
}

export async function isExecutableInPath(command: string): Promise<boolean> {
    const lookupCmd = isWindows() ? `where.exe ${command}` : `which ${command}`;
    try {
        await execAsync(lookupCmd);
        return true;
    } catch {
        if (isWindows()) {
            try {
                await execAsync(`where ${command}`);
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
}

export function getClaudeConfigPath(): string {
    const home = os.homedir();
    const candidatePaths: string[] = [];

    // Optional environment variable override
    if (process.env.CLAUDE_CONFIG_DIR) {
        candidatePaths.push(path.join(process.env.CLAUDE_CONFIG_DIR, "config.json"));
    }

    // Standard ~/.claude.json across all platforms
    candidatePaths.push(path.join(home, ".claude.json"));

    // Platform-specific secondary paths
    if (isWindows()) {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        candidatePaths.push(path.join(appData, "Claude", "config.json"));
    } else {
        candidatePaths.push(path.join(home, ".claude", "config.json"));
        candidatePaths.push(path.join(home, ".config", "claude", "config.json"));
    }

    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    // Default standard config file
    return path.join(home, ".claude.json");
}

export function getOpenCodeConfigPath(): string {
    const home = os.homedir();
    const candidatePaths: string[] = [];

    if (isWindows()) {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        candidatePaths.push(path.join(appData, "opencode", "config.json"));
        candidatePaths.push(path.join(home, ".config", "opencode", "config.json"));
    } else if (isMacOS()) {
        candidatePaths.push(
            path.join(home, "Library", "Application Support", "opencode", "config.json")
        );
        candidatePaths.push(path.join(home, ".config", "opencode", "config.json"));
    } else {
        const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
        candidatePaths.push(path.join(xdgConfig, "opencode", "config.json"));
    }

    candidatePaths.push(path.join(home, ".opencode.json"));

    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    if (isWindows()) {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        return path.join(appData, "opencode", "config.json");
    }

    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    return path.join(xdgConfig, "opencode", "config.json");
}

export function formatShellExport(key: string, value: string, shell: ShellType): string {
    switch (shell) {
        case "powershell":
            return `$env:${key} = "${value}"`;
        case "cmd":
            return `set ${key}=${value}`;
        case "fish":
            return `set -gx ${key} "${value}";`;
        case "bash":
        case "zsh":
        default:
            return `export ${key}="${value}"`;
    }
}
