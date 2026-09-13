import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useReactFlow } from "@xyflow/react";

export function CanvasControls() {
    const { zoomIn, zoomOut, fitView } = useReactFlow();

    return (
        <div className="absolute left-3 bottom-3 z-20 flex items-center gap-1 rounded-full border border-hairline-soft bg-canvas p-1 shadow-none font-mono">
            <button
                type="button"
                onClick={() => fitView({ padding: 0.22, duration: 300 })}
                className="flex size-10 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                title="Fit & Center View"
            >
                <Maximize2 className="size-3" />
            </button>
            <div className="h-3.5 w-px bg-hairline-soft" />
            <button
                type="button"
                onClick={() => zoomIn({ duration: 250 })}
                className="flex size-10 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                title="Zoom In"
            >
                <ZoomIn className="size-3" />
            </button>
            <button
                type="button"
                onClick={() => zoomOut({ duration: 250 })}
                className="flex size-10 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                title="Zoom Out"
            >
                <ZoomOut className="size-3" />
            </button>
        </div>
    );
}
