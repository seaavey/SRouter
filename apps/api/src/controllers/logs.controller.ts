import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { LogsLogic } from "@/logic/logs.logic.js";
import { Ok } from "@/utils/response.js";
import { AnalyticsQuerySchema } from "@srouter/types";
import { onUsageUpdated } from "@/services/usageEvents.js";

const MAX_EVENT_STREAMS = 16;
let activeEventStreams = 0;

export class LogsController {
    public static async ListLogs(c: Context): Promise<Response> {
        const rawPage = c.req.query("page");
        const limit = Number(c.req.query("limit")) || 50;
        const status = c.req.query("status") as "all" | "success" | "error" | undefined;

        if (rawPage !== undefined) {
            const page = Number(rawPage) || 1;
            const result = await LogsLogic.getPaginatedLogs(page, limit, status);
            return Ok(c, {
                object: "list",
                data: result.data,
                pagination: result.pagination
            });
        }

        return Ok(c, {
            object: "list",
            data: await LogsLogic.getRecentLogs(limit)
        });
    }

    public static async GetStats(c: Context): Promise<Response> {
        return Ok(c, await LogsLogic.getUsageStats());
    }

    public static GetEvents(c: Context): Response {
        if (activeEventStreams >= MAX_EVENT_STREAMS) {
            throw new HTTPException(429, { message: "Too many usage event streams" });
        }

        activeEventStreams += 1;
        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let released = false;

        const release = () => {
            if (released) return;
            released = true;
            if (heartbeat) clearInterval(heartbeat);
            unsubscribe?.();
            unsubscribe = null;
            heartbeat = null;
            activeEventStreams -= 1;
        };

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const send = (data: string) => {
                    try {
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    } catch {
                        release();
                    }
                };

                send(JSON.stringify({ type: "connected" }));
                unsubscribe = onUsageUpdated(() => {
                    void Promise.all([LogsLogic.getUsageStats(), LogsLogic.getRecentLogs(1)]).then(
                        ([stats, logs]) => {
                            send(JSON.stringify({ type: "usage.updated", stats }));
                            const log = logs[0];
                            if (log) send(JSON.stringify({ type: "request.logged", log }));
                        }
                    );
                });
                heartbeat = setInterval(() => {
                    try {
                        controller.enqueue(encoder.encode(": ping\n\n"));
                    } catch {
                        release();
                    }
                }, 25_000);
            },
            cancel: release
        });

        return c.body(stream, 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        });
    }

    public static async GetAnalytics(c: Context): Promise<Response> {
        const Query = c.req.query("window") || "24h";
        const Result = AnalyticsQuerySchema.safeParse({ window: Query });
        if (!Result.success) {
            throw new HTTPException(400, { message: "Invalid window parameter" });
        }
        return Ok(c, await LogsLogic.getAnalytics(Result.data.window));
    }
}
