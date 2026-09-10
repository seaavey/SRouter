import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 shadow-none",
    {
        variants: {
            variant: {
                default:
                    "bg-primary text-primary-foreground hover:opacity-90 transition-all font-semibold rounded-full px-5 h-10 shadow-none",
                outline:
                    "bg-canvas text-ink border border-hairline rounded-full px-5 h-10 font-semibold hover:bg-canvas-soft transition-all shadow-none",
                secondary:
                    "bg-canvas-soft text-ink rounded-full px-4 h-9 font-medium hover:bg-field transition-all shadow-none",
                "pill-soft":
                    "bg-canvas-soft text-ink rounded-full px-4 h-9 font-medium hover:bg-field transition-all shadow-none",
                ghost: "text-ink rounded-full px-4 h-9 hover:bg-canvas-soft transition-all shadow-none",
                destructive:
                    "bg-red-500/10 text-red-600 dark:text-red-400 rounded-full px-5 h-10 font-semibold hover:bg-red-500/20 transition-all shadow-none",
                link: "text-primary underline-offset-4 hover:underline shadow-none",
                icon: "rounded-full w-10 h-10 p-0 flex items-center justify-center shadow-none"
            },
            size: {
                default: "gap-1.5",
                xs: "h-6 gap-1 rounded-full px-2 text-xs in-data-[slot=button-group]:rounded-full has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
                sm: "h-7 gap-1 rounded-full px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-full has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
                lg: "h-11 gap-2 rounded-full px-6 text-base",
                icon: "rounded-full w-10 h-10 p-0 flex items-center justify-center",
                "icon-xs":
                    "size-6 rounded-full in-data-[slot=button-group]:rounded-full [&_svg:not([class*='size-'])]:size-3",
                "icon-sm": "size-7 rounded-full in-data-[slot=button-group]:rounded-full",
                "icon-lg": "size-10 rounded-full"
            }
        },
        defaultVariants: {
            variant: "default",
            size: "default"
        }
    }
);

function Button({
    className,
    variant = "default",
    size = "default",
    ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
    return (
        <ButtonPrimitive
            data-slot="button"
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { Button, buttonVariants };
