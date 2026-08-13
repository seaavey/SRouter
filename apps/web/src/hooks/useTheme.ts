import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "srouter-theme";

function getInitialTheme(): Theme {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme() {
    const [theme, setTheme] = useState<Theme>(getInitialTheme);

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("dark", theme === "dark");
        root.style.colorScheme = theme;
        window.localStorage.setItem(STORAGE_KEY, theme);
    }, [theme]);

    const toggleTheme = useCallback(
        (event?: React.MouseEvent) => {
            const next = theme === "dark" ? "light" : "dark";

            // Fallback for browsers without View Transitions API
            if (typeof document === "undefined" || !("startViewTransition" in document)) {
                setTheme(next);
                return;
            }

            const x = event?.clientX ?? window.innerWidth / 2;
            const y = event?.clientY ?? window.innerHeight / 2;
            const endRadius = Math.hypot(
                Math.max(x, window.innerWidth - x),
                Math.max(y, window.innerHeight - y),
            );

            const transition = (
                document as unknown as {
                    startViewTransition: (cb: () => void) => { ready: Promise<void> };
                }
            ).startViewTransition(() => {
                setTheme(next);
            });

            transition.ready.then(() => {
                const clipPath = [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(${endRadius}px at ${x}px ${y}px)`,
                ];
                document.documentElement.animate(
                    {
                        clipPath: theme === "dark" ? clipPath : [...clipPath].reverse(),
                    },
                    {
                        duration: 500,
                        easing: "ease-in-out",
                        pseudoElement:
                            theme === "dark"
                                ? "::view-transition-new(root)"
                                : "::view-transition-old(root)",
                    },
                );
            });
        },
        [theme],
    );

    return { theme, toggleTheme };
}
