import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "@/lib/utils";
import { CheckIcon, MinusIcon } from "lucide-react";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
    return (
        <CheckboxPrimitive.Root
            data-slot="checkbox"
            className={cn(
                "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground cursor-pointer",
                className
            )}
            {...props}
        >
            <CheckboxPrimitive.Indicator
                data-slot="checkbox-indicator"
                className="grid place-content-center text-current transition-none [&>svg]:size-3"
            >
                <CheckIcon className="size-3 stroke-[2.5] in-[[data-indeterminate]]:hidden" />
                <MinusIcon className="size-3 stroke-[2.5] hidden in-[[data-indeterminate]]:block" />
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
}

export { Checkbox };
