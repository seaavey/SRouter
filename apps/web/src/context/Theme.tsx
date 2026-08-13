"use client";

import * as React from "react";
import { useTheme as useThemeState } from "@/hooks/useTheme";

type ThemeContextValue = ReturnType<typeof useThemeState>;

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function ThemeProvider({ children }: React.PropsWithChildren) {
    const value = useThemeState();

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useTheme() {
    const context = React.useContext(ThemeContext);

    if (!context) {
        throw new Error("useTheme must be used within ThemeProvider");
    }

    return context;
}

export { ThemeProvider, useTheme };
