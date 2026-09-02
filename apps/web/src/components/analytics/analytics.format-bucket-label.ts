export function formatBucketLabel(bucketSizeMs: number): string {
    if (bucketSizeMs >= 86_400_000) return "day";
    if (bucketSizeMs >= 3_600_000) return "hour";
    return "min";
}
