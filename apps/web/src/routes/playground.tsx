import { useEffect } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ModelListResponse } from "@srouter/types";
import { usePlayground } from "@/hooks/usePlayground";
import { CodeSheet } from "@/components/playground/CodeSheet";
import { ConversationViewport } from "@/components/playground/ConversationViewport";
import { MessageComposer } from "@/components/playground/MessageComposer";
import { ParamsSheet } from "@/components/playground/ParamsSheet";
import { PlaygroundCommandBar } from "@/components/playground/PlaygroundCommandBar";
import { RequestSummary } from "@/components/playground/RequestSummary";

export const Route = createFileRoute("/playground")({
    staticData: { title: "Playground" },
    validateSearch: (search: Record<string, unknown>) => ({
        model: (search.model as string) || "",
    }),
    component: PlaygroundPage,
});

function PlaygroundPage() {
    const search = useSearch({ from: "/playground" });

    const {
        data: modelsData,
        isPending: modelsPending,
        isError: modelsError,
        error: modelsQueryError,
        refetch: refetchModels,
    } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
    });

    const models = modelsData?.data ?? [];
    const chat = usePlayground(search.model || "", models);

    // Keep the selected model in sync with the `model` search param and the loaded model list.
    useEffect(() => {
        if (models.length === 0) return;
        const requestedModel =
            search.model && models.some((item) => item.id === search.model) ? search.model : "";
        if (requestedModel && requestedModel !== chat.model) {
            chat.setModel(requestedModel);
            return;
        }
        if (!models.some((item) => item.id === chat.model)) {
            chat.setModel(models[0].id);
        }
    }, [chat.model, models, search.model, chat]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <PlaygroundCommandBar
                models={models}
                model={chat.model}
                selectedModel={chat.selectedModel}
                modelsPending={modelsPending}
                modelsError={modelsError}
                modelsQueryError={modelsQueryError}
                onModelChange={chat.setModel}
                onRetryModels={() => void refetchModels()}
                onOpenParams={() => chat.setShowParamsSheet(true)}
                onOpenCode={() => chat.setShowCodeSheet(true)}
                onClear={() => chat.setMessages([])}
                hasMessages={chat.messages.length > 0}
            />

            <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_15rem]">
                <div className="flex min-h-[34rem] min-w-0 flex-col overflow-hidden border border-border bg-background">
                    <ConversationViewport
                        messages={chat.messages}
                        selectedModel={chat.selectedModel}
                        streaming={chat.streaming}
                    />
                    <MessageComposer
                        input={chat.input}
                        selectedModel={chat.selectedModel}
                        streaming={chat.streaming}
                        onInputChange={chat.setInput}
                        onSend={() => void chat.send()}
                        onCancel={chat.cancel}
                    />
                </div>

                <RequestSummary
                    selectedModel={chat.selectedModel}
                    temperature={chat.temperature}
                    topP={chat.topP}
                    maxTokens={chat.maxTokens}
                    systemPrompt={chat.systemPrompt}
                    onEditParams={() => chat.setShowParamsSheet(true)}
                />
            </div>

            <p className="sr-only" role="status" aria-live="polite">
                {chat.statusMessage}
            </p>

            <ParamsSheet
                open={chat.showParamsSheet}
                onOpenChange={chat.setShowParamsSheet}
                systemPrompt={chat.systemPrompt}
                temperature={chat.temperature}
                topP={chat.topP}
                maxTokens={chat.maxTokens}
                onSystemPromptChange={chat.setSystemPrompt}
                onTemperatureChange={chat.setTemperature}
                onTopPChange={chat.setTopP}
                onMaxTokensChange={chat.setMaxTokens}
            />
            <CodeSheet
                open={chat.showCodeSheet}
                onOpenChange={chat.setShowCodeSheet}
                generatedCurl={chat.generatedCurl}
                canCopy={chat.hasUsableModel}
                copied={chat.copiedSnippet}
                onCopy={() => void chat.handleCopyCode()}
            />
        </div>
    );
}
