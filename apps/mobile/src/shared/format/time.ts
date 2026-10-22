/** "14:05" or "2:05 PM": a time of day on this phone's clock. */
export function formatTime(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}
