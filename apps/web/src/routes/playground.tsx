import { useEffect } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ModelListResponse } from "@srouter/types";
import { usePlayground } from "@/hooks/usePlayground";
import { ChatHistoryModal, CodeSheet, ConversationViewport, MessageComposer } from "@/components/playground";

export const Route = createFileRoute("/playground")({
    staticData: { title: "Playground" },
    validateSearch: (search: Record<string, unknown>) => ({
        model: (search.model as string) || ""
    }),
    component: PlaygroundPage
});

function PlaygroundPage() {
    const search = useSearch({ from: "/playground" });

    const {
        data: modelsData,
        isPending: modelsPending,
        isError: modelsError,
        error: modelsQueryError,
        refetch: refetchModels
    } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models")
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
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            {/* Main Interactive Chat Studio */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[14px] border border-[var(--line)] bg-[var(--surface)] shadow-xs">
                <ConversationViewport
                    messages={chat.messages}
                    selectedModel={chat.selectedModel}
                    streaming={chat.streaming}
                    chatId={chat.chatId}
                    onStarterClick={(prompt) => void chat.send(prompt)}
                    onRetry={chat.retryLast}
                    onDeleteMessage={chat.deleteMessage}
                />

                <MessageComposer
                    input={chat.input}
                    model={chat.model}
                    models={models}
                    selectedModel={chat.selectedModel}
                    streaming={chat.streaming}
                    hasMessages={chat.messages.length > 0}
                    onModelChange={chat.setModel}
                    onInputChange={chat.setInput}
                    onSend={() => void chat.send()}
                    onCancel={chat.cancel}
                    onOpenHistory={() => chat.setShowHistoryModal(true)}
                    sessionsCount={chat.sessions.length}
                    thinkingEnabled={chat.thinkingEnabled}
                    onToggleThinking={() => chat.setThinkingEnabled((prev) => !prev)}
                    systemPrompt={chat.systemPrompt}
                    onSystemPromptChange={chat.setSystemPrompt}
                    temperature={chat.temperature}
                    onTemperatureChange={chat.setTemperature}
                    maxTokens={chat.maxTokens}
                    onMaxTokensChange={chat.setMaxTokens}
                    onOpenCode={() => chat.setShowCodeSheet(true)}
                    onClear={chat.clearMessages}
                />
            </div>

            <p className="sr-only" role="status" aria-live="polite">
                {chat.statusMessage}
            </p>

            {/* Chat History & Session Manager Modal */}
            <ChatHistoryModal
                open={chat.showHistoryModal}
                onOpenChange={chat.setShowHistoryModal}
                sessions={chat.sessions}
                activeChatId={chat.chatId}
                onSwitchSession={chat.switchSession}
                onCreateSession={chat.createSession}
                onDeleteSession={chat.deleteSession}
                onCopyChatId={chat.copyChatId}
                copiedChatId={chat.copiedChatId}
            />

            {/* Multi-language Code Export Sheet */}
            <CodeSheet
                open={chat.showCodeSheet}
                onOpenChange={chat.setShowCodeSheet}
                exportLanguage={chat.exportLanguage}
                onExportLanguageChange={chat.setExportLanguage}
                generateCode={chat.generateCode}
                canCopy={chat.hasUsableModel}
                copied={chat.copiedSnippet}
                onCopy={() => void chat.handleCopyCode()}
                selectedModel={chat.selectedModel}
            />
        </div>
    );
}
