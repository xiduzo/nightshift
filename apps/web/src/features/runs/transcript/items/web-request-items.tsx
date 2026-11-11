/** The item of a web request: what the step asked, and how the server answered. */
import { GlobeIcon, GlobeLockIcon } from "lucide-react";
import type { WebRequestItem } from "../transcript-items";
import { ResultCard } from "./parts";

/** The tone of an answer: 2xx is good, no answer or another status is not. */
function toneOf(status: number | null | undefined): string {
	if (status === undefined) return "text-muted-foreground";
	if (status !== null && status >= 200 && status < 300) {
		return "text-status-finished";
	}
	return "text-status-failed";
}

/** The size of an answer: "512 B", "3 KB", "1.2 MB". */
function sizeOf(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The request, then its status, or why no answer came. */
export function WebRequestCard({ item }: { item: WebRequestItem }) {
	const answered = item.status !== undefined;
	return (
		<ResultCard
			icon={item.status === null ? GlobeLockIcon : GlobeIcon}
			kicker={item.method}
			value={<code className="break-all font-mono">{item.url}</code>}
			tone={toneOf(item.status)}
		>
			{answered ? (
				<p className="break-words leading-relaxed">
					{item.status === null
						? item.text
						: `${item.status} ${item.text}`.trim()}
					{item.bytes !== null && item.bytes !== undefined
						? ` · ${sizeOf(item.bytes)}`
						: null}
				</p>
			) : null}
		</ResultCard>
	);
}
