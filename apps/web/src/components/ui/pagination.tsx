import type { ComponentProps } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

function Pagination({ className, ...props }: ComponentProps<"nav">) {
    return (
        <nav
            role="navigation"
            aria-label="pagination"
            className={cn("mx-auto flex w-full justify-center", className)}
            {...props}
        />
    );
}

function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
    return <ul className={cn("flex flex-row items-center gap-1", className)} {...props} />;
}

function PaginationItem({ className, ...props }: ComponentProps<"li">) {
    return <li className={cn("", className)} {...props} />;
}

type PaginationLinkProps = {
    isActive?: boolean;
} & ComponentProps<"button">;

function PaginationLink({ className, isActive, ...props }: PaginationLinkProps) {
    return (
        <button
            aria-current={isActive ? "page" : undefined}
            className={cn(
                buttonVariants({ variant: isActive ? "outline" : "ghost", size: "icon-xs" }),
                className
            )}
            {...props}
        />
    );
}

function PaginationPrevious({ className, ...props }: ComponentProps<typeof Button>) {
    return (
        <Button
            aria-label="Go to previous page"
            variant="ghost"
            size="sm"
            className={cn("gap-1.5 px-2.5", className)}
            {...props}
        >
            <ChevronLeft />
            <span>Previous</span>
        </Button>
    );
}

function PaginationNext({ className, ...props }: ComponentProps<typeof Button>) {
    return (
        <Button
            aria-label="Go to next page"
            variant="ghost"
            size="sm"
            className={cn("gap-1.5 px-2.5", className)}
            {...props}
        >
            <span>Next</span>
            <ChevronRight />
        </Button>
    );
}

function PaginationEllipsis({ className, ...props }: ComponentProps<"span">) {
    return (
        <span
            aria-hidden
            className={cn("flex size-7 items-center justify-center", className)}
            {...props}
        >
            <MoreHorizontal className="size-4" />
            <span className="sr-only">More pages</span>
        </span>
    );
}

export {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious
};
