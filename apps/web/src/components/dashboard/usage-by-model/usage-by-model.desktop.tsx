import type { HeaderGroup, Row } from "@tanstack/react-table";
import { flexRender, type Table as TanStackTable } from "@tanstack/react-table";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import type { ModelUsageItem } from "./usage-by-model.typed";

type UsageByModelDesktopProps = {
    table: TanStackTable<ModelUsageItem>;
};

export function UsageByModelDesktop({ table }: UsageByModelDesktopProps) {
    return (
        <Table className="hidden min-w-[900px] lg:table">
            <TableHeader>
                {table.getHeaderGroups().map((header_group: HeaderGroup<ModelUsageItem>) => (
                    <TableRow key={header_group.id}>
                        {header_group.headers.map((header) => (
                            <TableHead
                                key={header.id}
                                className={header.id !== "model" ? "text-right" : ""}
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
                {table.getRowModel().rows.map((row: Row<ModelUsageItem>) => (
                    <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                            <TableCell
                                key={cell.id}
                                className={cell.column.id !== "model" ? "text-right" : ""}
                            >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
