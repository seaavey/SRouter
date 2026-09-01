import type { Context } from "hono";
import { Err, Ok } from "@/utils/response.js";
import { TunnelConfigSchema } from "@srouter/types";
import {
    getInstallStatus,
    getTunnelDomain,
    getTunnelStatus,
    getTunnelToken,
    installCloudflared,
    onTunnelUpdate,
    setTunnelDomain,
    setTunnelToken,
    startTunnel,
    stopTunnel
} from "@/services/cloudflareTunnel.js";

/** Cap concurrent SSE tunnel-event streams so one session cannot exhaust workers. */
const MAX_EVENT_STREAMS = 8;
let ActiveEventStreams = 0;

export class TunnelController {
    public static GetStatus(c: Context): Response {
        const Status = getTunnelStatus();
        return Ok(c, { ...Status, tokenConfigured: Boolean(getTunnelToken()) });
    }

    public static GetEvents(c: Context): Response {
        if (ActiveEventStreams >= MAX_EVENT_STREAMS) {
            return Err(c, "Too many concurrent tunnel event streams", 429, {
                code: "too_many_streams"
            });
        }
        ActiveEventStreams += 1;

        const Encoder = new TextEncoder();
        let Unsubscribe: (() => void) | null = null;
        let Heartbeat: ReturnType<typeof setInterval> | null = null;

        const Release = () => {
            if (Heartbeat) clearInterval(Heartbeat);
            if (Unsubscribe) Unsubscribe();
            Unsubscribe = null;
            Heartbeat = null;
            ActiveEventStreams -= 1;
        };

        const Stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const Send = (data: unknown) => {
                    try {
                        controller.enqueue(Encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                    } catch {}
                };

                try {
                    Send({ ...getTunnelStatus(), tokenConfigured: Boolean(getTunnelToken()) });

                    Unsubscribe = onTunnelUpdate((Status) => {
                        Send({ ...Status, tokenConfigured: Boolean(getTunnelToken()) });
                    });

                    Heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(Encoder.encode(`: ping\n\n`));
                        } catch {}
                    }, 25_000);
                } catch (SetupError) {
                    Release();
                    throw SetupError;
                }
            },
            cancel() {
                Release();
            }
        });

        return c.body(Stream, 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        });
    }

    public static async StartTunnel(c: Context): Promise<Response> {
        const RawBody = await c.req.json().catch(() => ({}));
        const Parsed = TunnelConfigSchema.safeParse(RawBody);
        const Data = Parsed.success ? Parsed.data : {};

        if (Data.token) setTunnelToken(Data.token);
        if (Data.domain) setTunnelDomain(Data.domain);

        const Result = startTunnel();
        return Result.success ? Ok(c, Result) : Err(c, Result.message, 400);
    }

    public static StopTunnel(c: Context): Response {
        const Result = stopTunnel();
        return Result.success ? Ok(c, Result) : Err(c, Result.message, 400);
    }

    public static async UpdateConfig(c: Context): Promise<Response> {
        const RawBody = await c.req.json().catch(() => null);
        const Parsed = TunnelConfigSchema.safeParse(RawBody);
        if (!Parsed.success || (!Parsed.data.token && !Parsed.data.domain)) {
            return Err(c, "Provide 'token' and/or 'domain'", 400);
        }

        if (Parsed.data.token) setTunnelToken(Parsed.data.token);
        if (Parsed.data.domain) setTunnelDomain(Parsed.data.domain);

        return Ok(c, {
            message: "Tunnel configuration updated",
            domain: getTunnelDomain() || undefined
        });
    }

    public static Install(c: Context): Response {
        const Result = installCloudflared();
        return Result.success ? Ok(c, Result) : Err(c, Result.message, 400);
    }

    public static GetInstallStatus(c: Context): Response {
        return Ok(c, getInstallStatus());
    }
}
