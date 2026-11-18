import { formatDuration } from "@/shared/format";
import type { ThinkingItem } from "../transcript-items";

/** "Thought for 12s", or "Thought" when it took less than a second. */
export function thoughtTitle(item: ThinkingItem): string {
	const ms = item.endedAt - item.startedAt;
	return ms < 1000 ? "Thought" : `Thought for ${formatDuration(ms)}`;
}
