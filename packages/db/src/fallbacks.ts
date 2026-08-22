import type {
    CreateFallbackRuleInput,
    FallbackRule,
    UpdateFallbackRuleInput
} from "@srouter/types";
import { db } from "./db.js";
import { generateId, num } from "./row-utils.js";

interface FallbackRuleRow {
    id: string;
    source_model: string;
    target_model: string;
    priority: number;
    enabled: number;
    trigger_on_status: string | null;
    max_retries: number | null;
    created_at: number;
}

function rowToFallbackRule(row: FallbackRuleRow): FallbackRule {
    let triggerOnStatus: number[] | undefined;
    if (row.trigger_on_status) {
        try {
            const parsed = JSON.parse(row.trigger_on_status);
            if (Array.isArray(parsed)) {
                triggerOnStatus = parsed.map((s) => Number(s));
            }
        } catch {
            triggerOnStatus = undefined;
        }
    }

    return {
        id: row.id,
        sourceModel: row.source_model,
        targetModel: row.target_model,
        priority: num(row.priority, 1),
        enabled: Boolean(row.enabled),
        triggerOnStatus,
        maxRetries: row.max_retries !== null ? num(row.max_retries) : undefined,
        createdAt: num(row.created_at)
    };
}

export function getAllFallbackRulesDB(): FallbackRule[] {
    const stmt = db.prepare("SELECT * FROM fallback_rules ORDER BY priority ASC, created_at ASC");
    const rows = stmt.all() as unknown as FallbackRuleRow[];
    return rows.map(rowToFallbackRule);
}

export function getFallbackRuleByIdDB(id: string): FallbackRule | null {
    const stmt = db.prepare("SELECT * FROM fallback_rules WHERE id = ?");
    const row = stmt.get(id) as unknown as FallbackRuleRow | undefined;
    if (!row) return null;
    return rowToFallbackRule(row);
}

export function createFallbackRuleDB(input: CreateFallbackRuleInput): FallbackRule {
    const id = input.id || generateId("fb");
    const createdAt = input.createdAt || Date.now();
    const triggerStatusStr = input.triggerOnStatus ? JSON.stringify(input.triggerOnStatus) : null;

    const stmt = db.prepare(`
        INSERT INTO fallback_rules (id, source_model, target_model, priority, enabled, trigger_on_status, max_retries, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        id,
        input.sourceModel,
        input.targetModel,
        input.priority ?? 1,
        input.enabled !== false ? 1 : 0,
        triggerStatusStr,
        input.maxRetries ?? 1,
        createdAt
    );

    return {
        id,
        sourceModel: input.sourceModel,
        targetModel: input.targetModel,
        priority: input.priority ?? 1,
        enabled: input.enabled !== false,
        triggerOnStatus: input.triggerOnStatus,
        maxRetries: input.maxRetries ?? 1,
        createdAt
    };
}

export function updateFallbackRuleDB(
    id: string,
    updates: UpdateFallbackRuleInput
): FallbackRule | null {
    const existing = getFallbackRuleByIdDB(id);
    if (!existing) return null;

    const updatedSourceModel = updates.sourceModel ?? existing.sourceModel;
    const updatedTargetModel = updates.targetModel ?? existing.targetModel;
    const updatedPriority = updates.priority ?? existing.priority;
    const updatedEnabled =
        updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled ? 1 : 0;
    const updatedTriggerStatus =
        updates.triggerOnStatus !== undefined
            ? updates.triggerOnStatus
                ? JSON.stringify(updates.triggerOnStatus)
                : null
            : existing.triggerOnStatus
              ? JSON.stringify(existing.triggerOnStatus)
              : null;
    const updatedMaxRetries = updates.maxRetries ?? existing.maxRetries ?? 1;

    const stmt = db.prepare(`
        UPDATE fallback_rules
        SET source_model = ?,
            target_model = ?,
            priority = ?,
            enabled = ?,
            trigger_on_status = ?,
            max_retries = ?
        WHERE id = ?
    `);

    stmt.run(
        updatedSourceModel,
        updatedTargetModel,
        updatedPriority,
        updatedEnabled,
        updatedTriggerStatus,
        updatedMaxRetries,
        id
    );

    return getFallbackRuleByIdDB(id);
}

export function deleteFallbackRuleDB(id: string): boolean {
    const stmt = db.prepare("DELETE FROM fallback_rules WHERE id = ?");
    stmt.run(id);
    return true;
}

/**
 * Finds all active, enabled fallback rules matching a given source model.
 * Matches:
 * 1. Exact match: rule.sourceModel === sourceModel
 * 2. Wildcard prefix match: rule.sourceModel === "prefix/*"
 * 3. Global wildcard: rule.sourceModel === "*"
 * Sorted by priority ASC, then exact match precedence, then created_at ASC.
 */
export function findMatchingFallbackRulesDB(sourceModel: string): FallbackRule[] {
    const allRules = getAllFallbackRulesDB().filter((r) => r.enabled);
    const normalizedSource = sourceModel.toLowerCase().trim();
    const prefix = sourceModel.includes("/") ? sourceModel.split("/")[0] : undefined;
    const normalizedPrefix = prefix?.toLowerCase().trim();

    const matches: { rule: FallbackRule; matchScore: number }[] = [];

    for (const rule of allRules) {
        const ruleSourceNormalized = rule.sourceModel.toLowerCase().trim();
        const ruleTargetNormalized = rule.targetModel.toLowerCase().trim();

        // Prevent trivial self-loop
        if (ruleTargetNormalized === normalizedSource) continue;

        if (rule.sourceModel === sourceModel || ruleSourceNormalized === normalizedSource) {
            // Exact match (highest priority score)
            matches.push({ rule, matchScore: 1 });
        } else if (ruleSourceNormalized.endsWith("/*")) {
            const rulePrefix = ruleSourceNormalized.slice(0, -2);
            if (
                normalizedPrefix &&
                (normalizedPrefix === rulePrefix || normalizedSource.startsWith(`${rulePrefix}/`))
            ) {
                matches.push({ rule, matchScore: 2 });
            }
        } else if (rule.sourceModel === "*") {
            matches.push({ rule, matchScore: 3 });
        }
    }

    matches.sort((a, b) => {
        if (a.rule.priority !== b.rule.priority) {
            return a.rule.priority - b.rule.priority;
        }
        if (a.matchScore !== b.matchScore) {
            return a.matchScore - b.matchScore;
        }
        return a.rule.createdAt - b.rule.createdAt;
    });

    return matches.map((m) => m.rule);
}
