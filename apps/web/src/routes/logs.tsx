import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/logs")({
    staticData: { title: "Logs" },
    component: LogsLayout
});

function LogsLayout() {
    return <Outlet />;
}
