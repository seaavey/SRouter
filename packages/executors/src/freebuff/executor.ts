import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject,
} from "@srouter/types";
import { FreebuffCoordinator, type FreebuffCoordinatorOptions } from "./coordinator.js";
import { withFreebuffModelPrefix } from "./convert.js";
import type { FreebuffConnectionConfig } from "./types.js";

export interface FreebuffExecutorOptions extends FreebuffCoordinatorOptions {
    readonly id?: string;
    readonly name?: string;
    readonly connections?: readonly FreebuffConnectionConfig[];
}

export class FreebuffExecutor implements AIProvider {
    public readonly id: string;
    public readonly name: string;
    public readonly category = "free_tier" as const;
    public readonly protocol = "openai" as const;
    private readonly coordinator: FreebuffCoordinator;

    public constructor(options: FreebuffExecutorOptions = {}) {
        this.id = options.id ?? "freebuff";
        this.name = options.name ?? "FreeBuff";
        this.coordinator = new FreebuffCoordinator(options);
        for (const connection of options.connections ?? []) this.coordinator.register(connection);
    }

    public async listModels(): Promise<ModelObject[]> {
        const models = await this.coordinator.listModels();
        return models.map((model) => ({ ...model, id: withFreebuffModelPrefix(model.id), owned_by: "freebuff" }));
    }

    public chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        return this.coordinator.chatCompletion({ ...request, model: withFreebuffModelPrefix(request.model) });
    }

    public chatCompletionStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, void> {
        return this.coordinator.chatCompletionStream({ ...request, model: withFreebuffModelPrefix(request.model) });
    }

    public register(config: FreebuffConnectionConfig): void {
        this.coordinator.register(config);
    }

    public replaceConnections(configs: readonly FreebuffConnectionConfig[]): void {
        this.coordinator.replaceConnections(configs);
    }

    public unregister(connectionId: string): Promise<void> {
        return this.coordinator.unregister(connectionId);
    }

    public setEnabled(connectionId: string, enabled: boolean): void {
        this.coordinator.setEnabled(connectionId, enabled);
    }

    public updateToken(connectionId: string, accessToken: string): void {
        this.coordinator.updateToken(connectionId, accessToken);
    }

    public start(signal?: AbortSignal): Promise<void> {
        return this.coordinator.start(signal);
    }

    public shutdown(signal?: AbortSignal): Promise<void> {
        return this.coordinator.shutdown(signal === undefined ? {} : { signal });
    }

    public snapshot(): ReturnType<FreebuffCoordinator["snapshot"]> {
        return this.coordinator.snapshot();
    }
}
