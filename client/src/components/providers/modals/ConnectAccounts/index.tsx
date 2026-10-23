import { KeyRound, ShieldCheck } from "lucide-react"
import { useState } from "react"

import { supportsTokenImport } from "@/api/providers"
import type { ProviderEntry } from "@/api/types"
import { BottomSheet } from "@/components/arc/bottom-sheet/bottom-sheet"
import { Button } from "@/components/arc/button/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/arc/tabs/tabs"
import { ProviderLogo } from "@/components/providers/provider-logo"
import { categoryLabel } from "@/components/providers/provider-labels"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useIsMobile from "@/components/seavx/ResponsiveDialog/hooks/useIsMobile"

import APIKeyPanel from "./panels/APIKeyPanel"
import OAuthPanel from "./panels/OAuthPanel"
import TokenImportPanel from "./panels/TokenImportPanel"
import useAPIKey from "./hooks/useAPIKey"
import useOAuthFlow from "./hooks/useOAuthFlow"
import useTokenImport from "./hooks/useTokenImport"

type AuthMode = "oauth" | "token"

export type ConnectAccountModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: ProviderEntry
  onSuccess: () => void
}

export function ConnectAccountModal({
  open,
  onOpenChange,
  provider,
  onSuccess,
}: ConnectAccountModalProps) {
  const [authMode, setAuthMode] = useState<AuthMode>("oauth")
  const [connectionName, setConnectionName] = useState("")
  const isMobile = useIsMobile()
  // Only the codex, claude, antigravity and commandcode drivers mount a token
  // route; the rest authenticate through their own device flow, so offering a
  // paste box there would only produce a credential that never works.
  const canImportToken = supportsTokenImport(provider.id)

  const oauth = useOAuthFlow({
    providerID: provider.id,
    onSuccess,
    onOpenChange,
  })
  const token = useTokenImport({
    providerID: provider.id,
    connectionName,
    onConnectionNameChange: setConnectionName,
    onSuccess,
    onOpenChange,
  })
  const apiKey = useAPIKey({
    providerID: provider.id,
    connectionName,
    onConnectionNameChange: setConnectionName,
    onSuccess,
    onOpenChange,
  })

  const pending = oauth.pending || token.pending || apiKey.pending

  // Dismissing clears every flow; a successful one closes the dialog directly,
  // so it clears its own fields instead of reaching this handler.
  function handleClose(isOpen: boolean) {
    if (pending) return
    onOpenChange(isOpen)
    if (isOpen) return
    oauth.reset()
    token.reset()
    apiKey.reset()
    setConnectionName("")
  }

  const content = (
    <div className="flex flex-col gap-4">
      {provider.requires_oauth &&
        (canImportToken ? (
          <Tabs
            value={authMode}
            onValueChange={(value) => {
              if (value === "oauth" || value === "token") setAuthMode(value)
            }}
            className="w-full"
          >
            <div className="flex w-full justify-center">
              <TabsList className="w-full">
                <TabsTrigger value="oauth" className="flex-1">
                  <ShieldCheck size={14} className="shrink-0" />
                  <span className="whitespace-nowrap">Browser OAuth</span>
                </TabsTrigger>
                <TabsTrigger value="token" className="flex-1">
                  <KeyRound size={14} className="shrink-0" />
                  <span className="whitespace-nowrap">
                    <span className="hidden sm:inline">
                      Direct token import
                    </span>
                    <span className="sm:hidden">Import token</span>
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="oauth" className="space-y-4">
              <OAuthPanel flow={oauth} providerName={provider.name} />
            </TabsContent>

            <TabsContent value="token" className="space-y-4">
              <TokenImportPanel
                providerID={provider.id}
                flow={token}
                connectionName={connectionName}
                onConnectionNameChange={setConnectionName}
              />
            </TabsContent>
          </Tabs>
        ) : (
          // One path only, so no strip to switch between: the driver's own
          // device flow is the whole story here.
          <OAuthPanel flow={oauth} providerName={provider.name} />
        ))}

      {provider.requires_api_key && (
        <APIKeyPanel
          flow={apiKey}
          connectionName={connectionName}
          onConnectionNameChange={setConnectionName}
        />
      )}

      {!provider.requires_oauth && !provider.requires_api_key && (
        <div className="rounded-xl border border-border/80 bg-surface-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
          This driver is preconfigured for free tier or local runtime routing.
          No external credential connection is required.
        </div>
      )}
    </div>
  )

  const headerDescription = provider.requires_oauth
    ? "Authorize routing with your provider session."
    : provider.requires_api_key
      ? "Register an upstream API key for this provider driver."
      : "Built-in provider runtime options."

  if (isMobile) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={handleClose}
        title={`Connect ${provider.name}`}
        description={headerDescription}
        detents={[0.85, 0.96]}
        initialDetent={0}
      >
        <div className="space-y-4 px-1 pt-1 pb-4">
          {content}
          <div className="pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleClose(false)}
              disabled={pending}
              className="h-9 w-full"
            >
              Close
            </Button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] w-full gap-5 overflow-y-auto p-5 sm:max-w-2xl">
        <DialogHeader className="gap-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-surface-muted/50 text-foreground shadow-xs">
              <ProviderLogo
                providerID={provider.id}
                protocol={provider.protocol}
                baseURL={provider.default_base_url}
                className="size-6"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <DialogTitle className="truncate text-sm font-medium text-foreground">
                  Connect {provider.name}
                </DialogTitle>
                <span className="rounded border border-border/60 bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {categoryLabel(provider.category)}
                </span>
              </div>
              <DialogDescription className="mt-0.5 truncate text-xs text-muted-foreground">
                {headerDescription}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {content}

        <DialogFooter showCloseButton={false} className="pt-1 sm:justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleClose(false)}
            disabled={pending}
            className="h-8 px-4"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
