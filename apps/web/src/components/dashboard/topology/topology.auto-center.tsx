import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

export function AutoCenterOnMount({ providerCount }: { providerCount: number }) {
    const { fitView } = useReactFlow();

    useEffect(() => {
        const timer1 = setTimeout(() => {
            fitView({ padding: 0.22, duration: 250 });
        }, 50);
        const timer2 = setTimeout(() => {
            fitView({ padding: 0.22 });
        }, 250);

        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
        };
    }, [fitView, providerCount]);

    return null;
}
