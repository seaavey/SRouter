import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/jetbrains-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./context/Theme";
import { Toaster } from "./components/ui/sonner";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: 1,
        },
    },
});

const router = createRouter({
    routeTree,
    context: { queryClient },
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

const rootElement = document.getElementById("root")!;

createRoot(rootElement).render(
    <StrictMode>
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
                <Toaster position="bottom-right" richColors closeButton />
            </QueryClientProvider>
        </ThemeProvider>
    </StrictMode>,
);
