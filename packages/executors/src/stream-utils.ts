// Streaming utilities shared by executors.

/**
 * Generic AWS-EventStream-style binary frame reader.
 * Yields raw frames (prelude + headers + payload + message CRC) as soon as
 * they are complete. Each yielded Uint8Array is an independent copy.
 */
export async function* iterEventStreamFrames(
    body: ReadableStream<Uint8Array>,
    maxFrameBytes: number
): AsyncGenerator<Uint8Array, void, void> {
    const reader = body.getReader();
    let pending: Uint8Array = new Uint8Array(0);

    const readU32 = (bytes: Uint8Array, at: number): number =>
        (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value?.length) continue;

            if (pending.length === 0) {
                pending = value;
            } else {
                const combined = new Uint8Array(pending.length + value.length);
                combined.set(pending);
                combined.set(value, pending.length);
                pending = combined;
            }

            let offset = 0;
            while (pending.length - offset >= 12) {
                const totalLength = readU32(pending, offset);
                if (totalLength < 16 || totalLength > maxFrameBytes)
                    throw new Error("Invalid AWS EventStream frame bounds");
                if (pending.length - offset < totalLength) break;
                yield pending.slice(offset, offset + totalLength);
                offset += totalLength;
            }
            if (offset > 0) {
                pending = pending.slice(offset);
            }
        }

        if (pending.length !== 0) throw new Error("Stream ended with incomplete frame");
    } finally {
        reader.releaseLock();
    }
}

/**
 * Callback variant of {@link iterEventStreamFrames} for consumers that
 * prefer a handler over iteration.
 */
export async function streamFrames(
    body: ReadableStream<Uint8Array>,
    onFrame: (frame: Uint8Array) => void
): Promise<void> {
    for await (const frame of iterEventStreamFrames(body, 24 * 1024 * 1024)) {
        onFrame(frame);
    }
}
