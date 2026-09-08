export interface StartupTasks {
    isPostgres: boolean;
    initDatabase: () => Promise<void>;
    bootstrapAdmin: () => Promise<void>;
    autostartTunnel: () => Promise<void>;
    startProviderRegistry: () => Promise<void>;
    onBackgroundError: (error: unknown) => void;
}

export async function RunStartupTasks(tasks: StartupTasks): Promise<void> {
    if (tasks.isPostgres) {
        await tasks.initDatabase();
    }

    await tasks.bootstrapAdmin();
    void tasks.autostartTunnel().catch(tasks.onBackgroundError);
    await tasks.startProviderRegistry();
}
