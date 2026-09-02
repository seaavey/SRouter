import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Search, Star } from "lucide-react";
import { useFavorites } from "@/hooks/useFavorites";
import type { PlaygroundModel } from "./playground.types";

interface ModelPickerDropdownProps {
    isOpen: boolean;
    models: PlaygroundModel[];
    currentModel: string;
    onSelectModel: (model: PlaygroundModel) => void;
    onClose: () => void;
}

export function ModelPickerDropdown({
    isOpen,
    models,
    currentModel,
    onSelectModel,
    onClose
}: ModelPickerDropdownProps) {
    const [search, setSearch] = useState("");
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listContainerRef = useRef<HTMLDivElement>(null);

    const { isFavorite, toggleFavorite } = useFavorites();

    // Auto-focus search input on open
    useEffect(() => {
        if (isOpen) {
            setSearch("");
            setHighlightedIndex(0);
            const timer = setTimeout(() => {
                searchInputRef.current?.focus();
            }, 10);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Handle outside click
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen, onClose]);

    // Filter and sort models efficiently
    const filteredModels = useMemo(() => {
        const effective =
            models.length > 0
                ? models
                : currentModel
                  ? [{ id: currentModel, owned_by: "gateway" }]
                  : [];

        const query = search.trim().toLowerCase();
        const matched = query
            ? effective.filter((m) => m.id.toLowerCase().includes(query))
            : effective;

        return matched.slice().sort((a, b) => {
            const favA = isFavorite(a.id) ? 1 : 0;
            const favB = isFavorite(b.id) ? 1 : 0;
            if (favA !== favB) return favB - favA;
            return a.id.localeCompare(b.id);
        });
    }, [models, currentModel, search, isFavorite]);

    // Reset highlighted index when filter results change
    useEffect(() => {
        setHighlightedIndex(0);
    }, [search]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (filteredModels.length === 0) return;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightedIndex((prev) => (prev + 1) % filteredModels.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightedIndex(
                    (prev) => (prev - 1 + filteredModels.length) % filteredModels.length
                );
            } else if (e.key === "Enter") {
                e.preventDefault();
                const selected = filteredModels[highlightedIndex] ?? filteredModels[0];
                if (selected) {
                    onSelectModel(selected);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        },
        [filteredModels, highlightedIndex, onSelectModel, onClose]
    );

    if (!isOpen) return null;

    return (
        <div
            ref={dropdownRef}
            className="absolute left-0 sm:left-10 bottom-full z-40 mb-2 w-72 sm:w-80 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-2xl backdrop-blur-md will-change-transform"
            style={{
                animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
                transformOrigin: "bottom left"
            }}
        >
            {/* Search Input */}
            <div className="relative mb-1 px-1 pt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--ink-3)]" />
                <input
                    ref={searchInputRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search models..."
                    className="h-7 w-full rounded-[6px] border border-[var(--line)] bg-[var(--canvas)] pl-8 pr-2 font-mono text-[11px] text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--line-strong)] focus:outline-none"
                />
            </div>

            {/* Models Scrollable List */}
            <div
                ref={listContainerRef}
                role="listbox"
                className="max-h-60 overflow-y-auto space-y-0.5 pt-1 overscroll-contain"
            >
                {filteredModels.length === 0 ? (
                    <div className="flex h-12 items-center justify-center font-mono text-[11px] text-[var(--ink-3)]">
                        No models found for “{search}”
                    </div>
                ) : (
                    filteredModels.map((m, i) => {
                        const isSelected = m.id === currentModel;
                        const isFav = isFavorite(m.id);
                        const isHighlighted = i === highlightedIndex;

                        return (
                            <button
                                key={m.id}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => onSelectModel(m)}
                                onMouseEnter={() => setHighlightedIndex(i)}
                                style={{
                                    contentVisibility: "auto",
                                    containIntrinsicSize: "auto 32px"
                                }}
                                className={`relative z-10 flex h-8 w-full items-center justify-between gap-2 rounded-[6px] px-2 text-left font-mono transition-colors duration-75 cursor-pointer select-none ${
                                    isHighlighted ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"
                                }`}
                            >
                                <div className="flex min-w-0 items-center gap-1.5 flex-1">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleFavorite(m.id);
                                        }}
                                        className={`p-0.5 rounded-[4px] transition-all cursor-pointer shrink-0 ${
                                            isFav
                                                ? "text-amber-500 hover:text-amber-400"
                                                : "text-[var(--ink-3)] hover:text-amber-500 opacity-30 hover:opacity-100"
                                        }`}
                                        title={isFav ? "Unpin model" : "Pin to top"}
                                        aria-label={isFav ? "Unpin model" : "Pin to top"}
                                    >
                                        <Star
                                            className={`size-3 ${
                                                isFav ? "fill-amber-500 text-amber-500" : ""
                                            }`}
                                        />
                                    </button>

                                    <Bot className="size-3 text-[var(--ink-3)] shrink-0" />
                                    <span
                                        className={`truncate text-[11.5px] font-medium ${
                                            isFav
                                                ? "text-amber-500 dark:text-amber-400 font-semibold"
                                                : "text-[var(--ink)]"
                                        }`}
                                    >
                                        {m.id}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {m.owned_by && (
                                        <span className="rounded bg-[var(--field)] px-1 py-0.2 text-[9px] text-[var(--ink-3)] uppercase font-semibold">
                                            {m.owned_by}
                                        </span>
                                    )}
                                    {isSelected && (
                                        <Check className="size-3 text-emerald-500 stroke-[2.5]" />
                                    )}
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
}
