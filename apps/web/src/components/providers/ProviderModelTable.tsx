import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
    type ColumnDef,
    type SortingState,
    type PaginationState,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from "@tanstack/react-table";
import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Bot,
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    Play,
    Star,
    Trash2,
    X
} from "lucide-react";
import type { ModelObject } from "@srouter/types";
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";

interface ProviderModelTableProps {
    models: ModelObject[];
    copied: string | null;
    onCopy: (modelId: string) => void;
    onDelete?: (modelId: string) => void;
    onDeleteMultiple?: (modelIds: string[]) => void;
}

export function ProviderModelTable({
    models,
    copied,
    onCopy,
    onDelete,
    onDeleteMultiple
}: ProviderModelTableProps) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 25
    });
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
    const { isFavorite, toggleFavorite, addMultipleFavorites } = useFavorites();

    const sortedData = useMemo(() => {
        if (sorting.length > 0) {
            return models;
        }
        return [...models].sort((a, b) => {
            const favA = isFavorite(a.id) ? 1 : 0;
            const favB = isFavorite(b.id) ? 1 : 0;
            if (favA !== favB) return favB - favA;
            return a.id.localeCompare(b.id);
        });
    }, [models, isFavorite, sorting]);

    const isAllSelected = sortedData.length > 0 && selectedIds.length === sortedData.length;
    const isSomeSelected = selectedIds.length > 0 && selectedIds.length < sortedData.length;

    // Clear selection on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && selectedIds.length > 0) {
                setSelectedIds([]);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedIds.length]);

    const toggleSelectAll = () => {
        if (isAllSelected) {
            setSelectedIds([]);
            setLastSelectedId(null);
        } else {
            setSelectedIds(sortedData.map((m) => m.id));
        }
    };

    const toggleSelectRow = (modelId: string, shiftKey: boolean = false) => {
        setSelectedIds((prev) => {
            const isCurrentlySelected = prev.includes(modelId);

            if (shiftKey && lastSelectedId && lastSelectedId !== modelId) {
                const currentIndex = sortedData.findIndex((m) => m.id === modelId);
                const lastIndex = sortedData.findIndex((m) => m.id === lastSelectedId);

                if (currentIndex !== -1 && lastIndex !== -1) {
                    const start = Math.min(currentIndex, lastIndex);
                    const end = Math.max(currentIndex, lastIndex);
                    const rangeIds = sortedData.slice(start, end + 1).map((m) => m.id);

                    const set = new Set(prev);
                    rangeIds.forEach((id) => set.add(id));
                    return Array.from(set);
                }
            }

            setLastSelectedId(modelId);
            return isCurrentlySelected ? prev.filter((id) => id !== modelId) : [...prev, modelId];
        });
    };

    const handleBulkFavorite = () => {
        addMultipleFavorites(selectedIds);
        toast.success(
            `Pinned ${selectedIds.length} model${selectedIds.length > 1 ? "s" : ""} to favorites`
        );
        setSelectedIds([]);
        setLastSelectedId(null);
    };

    const handleBulkDelete = () => {
        const targets = [...selectedIds];
        setSelectedIds([]);
        setLastSelectedId(null);
        if (onDeleteMultiple) {
            onDeleteMultiple(targets);
        } else if (onDelete) {
            targets.forEach((id) => onDelete(id));
        }
    };

    const columns = useMemo<ColumnDef<ModelObject>[]>(
        () => [
            {
                id: "select",
                header: () => (
                    <div className="flex items-center justify-center">
                        <Checkbox
                            checked={isAllSelected}
                            indeterminate={isSomeSelected}
                            onCheckedChange={toggleSelectAll}
                            title={isAllSelected ? "Deselect all" : "Select all"}
                            aria-label="Select all models"
                        />
                    </div>
                ),
                cell: ({ row }) => {
                    const isSelected = selectedIds.includes(row.original.id);
                    return (
                        <div
                            className="flex items-center justify-center"
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            <Checkbox
                                checked={isSelected}
                                onCheckedChange={(_, e) => {
                                    const nativeEvent = e as unknown as React.MouseEvent;
                                    toggleSelectRow(row.original.id, !!nativeEvent?.shiftKey);
                                }}
                                aria-label={`Select model ${row.original.id}`}
                            />
                        </div>
                    );
                }
            },
            {
                accessorKey: "id",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-[var(--ink)] transition-colors cursor-pointer"
                        >
                            <span>Model ID</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-amber-500" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-amber-500" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
                cell: ({ row }) => {
                    const model = row.original;
                    const isFav = isFavorite(model.id);

                    return (
                        <div className="flex items-center gap-2 min-w-0">
                            {/* Favorite / Pin Star Button */}
                            <button
                                type="button"
                                onClick={() => toggleFavorite(model.id)}
                                className={`p-1 rounded-[4px] transition-all cursor-pointer shrink-0 ${
                                    isFav
                                        ? "text-amber-500 hover:text-amber-400 bg-amber-500/10"
                                        : "text-[var(--ink-3)] hover:text-amber-500 opacity-40 group-hover:opacity-100 hover:bg-[var(--field)]"
                                }`}
                                title={
                                    isFav
                                        ? "Favorited (Pinned to top) - Click to unpin"
                                        : "Star model (Pin to top)"
                                }
                                aria-label={isFav ? "Unstar model" : "Star model"}
                            >
                                <Star
                                    className={`size-3.5 transition-transform ${
                                        isFav ? "fill-amber-500 text-amber-500 scale-110" : ""
                                    }`}
                                />
                            </button>

                            <div className="flex size-6 shrink-0 items-center justify-center rounded-[4px] bg-[var(--field)] text-[var(--ink-2)]">
                                <Bot className="size-3.5" />
                            </div>

                            <span
                                className={`font-bold truncate max-w-[220px] sm:max-w-md md:max-w-lg block text-xs ${
                                    isFav
                                        ? "text-amber-500 dark:text-amber-400"
                                        : "text-[var(--ink)]"
                                }`}
                                title={model.id}
                            >
                                {model.id}
                            </span>
                            {model.custom && (
                                <span className="inline-flex items-center rounded-[4px] bg-sky-500/10 px-1.5 py-0.2 text-[9.5px] font-bold text-sky-600 dark:text-sky-400 border border-sky-500/20 shrink-0">
                                    Custom
                                </span>
                            )}

                            <button
                                type="button"
                                onClick={() => onCopy(model.id)}
                                className="text-[var(--ink-3)] hover:text-[var(--ink)] p-1 rounded hover:bg-[var(--field)] transition-colors opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
                                title="Copy Model ID"
                            >
                                {copied === model.id ? (
                                    <Check className="size-3 text-emerald-500" />
                                ) : (
                                    <Copy className="size-3" />
                                )}
                            </button>
                        </div>
                    );
                }
            },
            {
                id: "status",
                header: "Status",
                cell: ({ row }) => {
                    const isFav = isFavorite(row.original.id);
                    return (
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[10.5px] font-semibold">
                                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Active</span>
                            </span>
                            {isFav && (
                                <span className="hidden md:inline-flex items-center gap-0.5 rounded-[4px] bg-amber-500/10 px-1.5 py-0.2 text-[9.5px] font-bold text-amber-500 border border-amber-500/20">
                                    ★ Pinned
                                </span>
                            )}
                        </div>
                    );
                }
            },
            {
                id: "actions",
                header: () => <div className="text-right">Actions</div>,
                cell: ({ row }) => {
                    const model = row.original;
                    return (
                        <div className="flex items-center justify-end gap-2">
                            <Link
                                to="/playground"
                                search={{ model: model.id }}
                                className="inline-flex items-center gap-1 rounded-[4px] bg-[var(--field)] hover:bg-[var(--ink)] hover:text-[var(--canvas)] px-2 py-1 font-semibold text-[10.5px] text-[var(--ink)] transition-colors border border-[var(--line)] cursor-pointer"
                            >
                                <Play className="size-2.5" />
                                <span>Test</span>
                            </Link>

                            {onDelete && (
                                <button
                                    type="button"
                                    onClick={() => onDelete(model.id)}
                                    className="text-[var(--ink-3)] hover:text-rose-500 hover:bg-rose-500/10 p-1 rounded transition-colors cursor-pointer"
                                    title="Hide model from list"
                                >
                                    <Trash2 className="size-3" />
                                </button>
                            )}
                        </div>
                    );
                }
            }
        ],
        [
            copied,
            onCopy,
            onDelete,
            isFavorite,
            toggleFavorite,
            selectedIds,
            isAllSelected,
            isSomeSelected
        ]
    );

    const table = useReactTable({
        data: sortedData,
        columns,
        state: {
            sorting,
            pagination
        },
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel()
    });

    const pageCount = table.getPageCount();
    const currentPage = table.getState().pagination.pageIndex;
    const pageSize = table.getState().pagination.pageSize;
    const totalRows = models.length;
    const startRow = totalRows === 0 ? 0 : currentPage * pageSize + 1;
    const endRow = Math.min((currentPage + 1) * pageSize, totalRows);

    return (
        <div className="space-y-3 font-mono">
            {/* Floating Bulk Action HUD Dock (Persists on scroll with Glassmorphism) */}
            {selectedIds.length > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-full border border-border/80 bg-card/95 backdrop-blur-md shadow-2xl ring-1 ring-black/10 dark:ring-white/10 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-200">
                    <div className="flex items-center gap-2 pr-1">
                        <span className="flex size-5 items-center justify-center rounded-full bg-amber-500 text-black text-[10px] font-bold">
                            {selectedIds.length}
                        </span>
                        <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                            {selectedIds.length} selected
                        </span>
                    </div>

                    <div className="h-4 w-px bg-border/80" />

                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={handleBulkFavorite}
                            className="inline-flex items-center gap-1.5 rounded-full bg-secondary hover:bg-secondary/80 px-3 py-1.5 text-xs font-semibold text-foreground transition-all cursor-pointer border border-border/60 shadow-2xs hover:scale-105 active:scale-95"
                            title="Pin selected models to favorites"
                        >
                            <Star className="size-3.5 text-amber-500 fill-amber-500" />
                            <span>Favorite</span>
                        </button>

                        {(onDeleteMultiple || onDelete) && (
                            <button
                                type="button"
                                onClick={handleBulkDelete}
                                className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 hover:bg-destructive/20 px-3 py-1.5 text-xs font-semibold text-destructive transition-all cursor-pointer border border-destructive/30 shadow-2xs hover:scale-105 active:scale-95"
                                title="Hide selected models from list"
                            >
                                <Trash2 className="size-3.5" />
                                <span>Hide</span>
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={() => setSelectedIds([])}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                            title="Clear selection (Esc)"
                        >
                            <X className="size-3.5" />
                            <span className="hidden sm:inline">Clear</span>
                            <kbd className="hidden sm:inline-block rounded border border-border/60 bg-muted px-1 text-[9px] text-muted-foreground font-mono">
                                Esc
                            </kbd>
                        </button>
                    </div>
                </div>
            )}

            {/* Table Container using @/components/ui/table & TanStack React Table */}
            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] shadow-2xs overflow-hidden">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow
                                key={headerGroup.id}
                                className="border-b border-[var(--line)] bg-[var(--field)]/50 hover:bg-[var(--field)]/50"
                            >
                                {headerGroup.headers.map((header) => (
                                    <TableHead
                                        key={header.id}
                                        className={`py-2.5 px-4 font-mono text-[10.5px] font-bold uppercase tracking-wider text-[var(--ink-3)] ${
                                            header.id === "status"
                                                ? "hidden sm:table-cell"
                                                : header.id === "actions"
                                                  ? "text-right"
                                                  : ""
                                        }`}
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef.header,
                                                  header.getContext()
                                              )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.map((row) => {
                            const isSelected = selectedIds.includes(row.original.id);
                            return (
                                <TableRow
                                    key={row.id}
                                    className={`group transition-colors ${
                                        isSelected
                                            ? "bg-amber-500/10 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:hover:bg-amber-500/20"
                                            : "hover:bg-[var(--hover)]/30"
                                    }`}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell
                                            key={cell.id}
                                            className={`py-2.5 px-4 ${
                                                cell.column.id === "status"
                                                    ? "hidden sm:table-cell"
                                                    : cell.column.id === "actions"
                                                      ? "text-right"
                                                      : ""
                                            }`}
                                        >
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 text-xs text-[var(--ink-3)]">
                <div className="flex items-center gap-2 text-[11px]">
                    <span>Showing</span>
                    <span className="font-semibold text-[var(--ink)]">
                        {totalRows === 0 ? 0 : `${startRow}-${endRow}`}
                    </span>
                    <span>of</span>
                    <span className="font-semibold text-[var(--ink)]">{totalRows}</span>
                    <span>models</span>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                    {/* Page Size Selector */}
                    <div className="flex items-center gap-1.5 text-[11px]">
                        <span>Rows:</span>
                        <select
                            value={pageSize}
                            onChange={(e) => table.setPageSize(Number(e.target.value))}
                            className="rounded-[4px] border border-[var(--line)] bg-[var(--field)] px-2 py-0.5 text-[11px] text-[var(--ink)] focus:outline-none cursor-pointer"
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>

                    {/* Page Navigation */}
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            className="flex size-6 items-center justify-center rounded-[4px] border border-[var(--line)] bg-[var(--field)] text-[var(--ink)] hover:bg-[var(--hover)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            title="Previous page"
                        >
                            <ChevronLeft className="size-3.5" />
                        </button>
                        <span className="px-2 text-[11px] text-[var(--ink)]">
                            {pageCount === 0 ? 1 : currentPage + 1} / {Math.max(1, pageCount)}
                        </span>
                        <button
                            type="button"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            className="flex size-6 items-center justify-center rounded-[4px] border border-[var(--line)] bg-[var(--field)] text-[var(--ink)] hover:bg-[var(--hover)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            title="Next page"
                        >
                            <ChevronRight className="size-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
