/**
 * What a Night Shift's procedures read beyond one plain call. It says so
 * on each answer of `/rpc`, in this header: `batch` (several calls in one
 * request, oRPC's batch format) and `gzip` (a request body sent with
 * `Content-Encoding: gzip`). A Night Shift of an older version says
 * nothing: its callers then send plain calls only.
 */
export const READS_HEADER = "x-nightshift-reads";

/** What this version reads, as it says in `READS_HEADER`. */
export const READS = "batch, gzip";

/** Whether the answer says its Night Shift reads `what`. */
export function reads(response: Response, what: "batch" | "gzip"): boolean {
	return (response.headers.get(READS_HEADER) ?? "")
		.split(",")
		.some((word) => word.trim() === what);
}
