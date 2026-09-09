import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";

type AnimatedNumberProps = {
    value: number;
    format?: (value: number) => string;
};

export function AnimatedNumber({ value, format = (current) => current.toLocaleString("en-US") }: AnimatedNumberProps) {
    const prefersReducedMotion = useReducedMotion();
    const [displayValue, setDisplayValue] = useState(value);
    const currentValue = useRef(value);

    useEffect(() => {
        if (prefersReducedMotion) {
            setDisplayValue(value);
            currentValue.current = value;
            return;
        }

        const controls = animate(currentValue.current, value, {
            duration: 0.55,
            ease: [0.22, 1, 0.36, 1],
            onUpdate: (latest) => {
                currentValue.current = latest;
                setDisplayValue(latest);
            }
        });

        return () => controls.stop();
    }, [value, prefersReducedMotion]);

    const text = format(Math.round(displayValue));

    if (prefersReducedMotion) {
        return <span className="block min-w-0 overflow-hidden whitespace-nowrap">{text}</span>;
    }

    return (
        <span className="flex min-w-0 overflow-hidden whitespace-nowrap" aria-label={text}>
            {Array.from(text).map((character, index) => (
                <span key={`${index}-${character}`} className="relative inline-block overflow-hidden">
                    <AnimatePresence initial={false} mode="popLayout">
                        <motion.span
                            key={character}
                            initial={{ y: "-100%", opacity: 0 }}
                            animate={{ y: "0%", opacity: 1 }}
                            exit={{ y: "100%", opacity: 0 }}
                            transition={{ duration: 2, ease: "easeOut" }}
                            className="inline-block"
                        >
                            {character}
                        </motion.span>
                    </AnimatePresence>
                </span>
            ))}
        </span>
    );
}
