import pc from "picocolors";
import { intro, outro, spinner, note } from "@clack/prompts";

export const banner = `
   ____  ____              __           
  / __/ / __ \\___  __ __  / /____  ____ 
 _\\ \\  / /_/ / _ \\/ // / / __/ -_)/ __/ 
/___/  \\____/\\___/\\_,_/  \\__/\\__//_/    
  ${pc.bold(pc.cyan("AI Gateway & LLM Proxy Router CLI"))}
`;

export function showHeader(): void {
    console.log(pc.magenta(banner));
}

export function formatSuccess(msg: string): string {
    return `${pc.green("✔")} ${msg}`;
}

export function formatError(msg: string): string {
    return `${pc.red("✖")} ${msg}`;
}

export function formatWarning(msg: string): string {
    return `${pc.yellow("⚠")} ${msg}`;
}

export function formatInfo(msg: string): string {
    return `${pc.cyan("ℹ")} ${msg}`;
}

export { pc, intro, outro, spinner, note };
