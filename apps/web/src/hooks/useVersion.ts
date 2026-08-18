import { useQuery } from "@tanstack/react-query";

export const CURRENT_VERSION = "v0.1.1";
export const GITHUB_REPO = "seaavey/SRouter";

export interface GitHubTag {
    name: string;
    zipball_url: string;
    tarball_url: string;
    commit: {
        sha: string;
        url: string;
    };
    node_id: string;
}

export interface VersionInfo {
    currentVersion: string;
    latestVersion: string | null;
    hasUpdate: boolean;
    releaseUrl: string;
    tagsUrl: string;
    isChecking: boolean;
    isError: boolean;
    lastChecked: Date | null;
}

export function compareVersions(v1: string, v2: string): number {
    const clean1 = v1.replace(/^v/, "").trim();
    const clean2 = v2.replace(/^v/, "").trim();

    if (clean1 === clean2) return 0;

    const [main1, pre1] = clean1.split("-");
    const [main2, pre2] = clean2.split("-");

    const parts1 = (main1 || "").split(".").map((n) => parseInt(n, 10) || 0);
    const parts2 = (main2 || "").split(".").map((n) => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }

    // A release without pre-release is newer than one with pre-release (0.1.0 > 0.1.0-rc.1)
    if (!pre1 && pre2) return 1;
    if (pre1 && !pre2) return -1;
    if (pre1 && pre2) {
        return pre1.localeCompare(pre2, undefined, { numeric: true, sensitivity: "base" });
    }

    return 0;
}

async function fetchLatestGitHubTag(): Promise<string | null> {
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/tags`, {
            headers: {
                Accept: "application/vnd.github.v3+json"
            }
        });

        if (!response.ok) {
            return null;
        }

        const tags: GitHubTag[] = await response.json();
        if (!Array.isArray(tags) || tags.length === 0) {
            return null;
        }

        // Find the newest version tag
        let highest = tags[0].name;
        for (let i = 1; i < tags.length; i++) {
            if (compareVersions(tags[i].name, highest) > 0) {
                highest = tags[i].name;
            }
        }

        return highest;
    } catch {
        return null;
    }
}

export function useVersion(): VersionInfo & { refetch: () => void } {
    const {
        data: latestTag,
        isLoading,
        isError,
        dataUpdatedAt,
        refetch
    } = useQuery({
        queryKey: ["github_latest_version", GITHUB_REPO],
        queryFn: fetchLatestGitHubTag,
        staleTime: 10 * 60 * 1000, // 10 minutes cache
        refetchOnWindowFocus: false
    });

    const hasUpdate = Boolean(latestTag && compareVersions(latestTag, CURRENT_VERSION) > 0);
    const resolvedLatest = latestTag ?? CURRENT_VERSION;
    const releaseUrl = `https://github.com/${GITHUB_REPO}/releases/tag/${resolvedLatest}`;
    const tagsUrl = `https://github.com/${GITHUB_REPO}/tags`;

    return {
        currentVersion: CURRENT_VERSION,
        latestVersion: latestTag ?? null,
        hasUpdate,
        releaseUrl,
        tagsUrl,
        isChecking: isLoading,
        isError,
        lastChecked: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
        refetch
    };
}
