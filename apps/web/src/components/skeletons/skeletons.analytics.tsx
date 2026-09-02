export function AnalyticsSkeleton() {
    return (
        <div className="flex flex-col gap-6 font-mono animate-pulse">
            <div className="h-20 rounded-xl bg-secondary/20" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-24 rounded-xl bg-secondary/20" />
                ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="h-56 rounded-xl bg-secondary/20" />
                <div className="h-40 rounded-xl bg-secondary/20" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="h-48 rounded-xl bg-secondary/20" />
                <div className="h-32 rounded-xl bg-secondary/20" />
            </div>
        </div>
    );
}
