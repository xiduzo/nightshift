/** The item of an End step: how it ends the run, and its message. */
import { FlagIcon } from "lucide-react";
import { END_STATUS_LABEL } from "@/features/flows";
import { formatTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import type { EndItem } from "../transcript-items";
import { ResultCard } from "./parts";

/** The tone of each result: a failure the flow chose reads as one. */
const TONE: Record<EndItem["status"], string> = {
	done: "text-status-finished",
	"nothing-to-do": "text-muted-foreground",
	failed: "text-destructive",
};

/** The run ends here: its result, and the line the flow wrote for you. */
export function EndCard({ item }: { item: EndItem }) {
	return (
		<ResultCard
			icon={FlagIcon}
			kicker="Ended ·"
			value={END_STATUS_LABEL[item.status]}
			tone={TONE[item.status]}
			extra={
				<span className="text-muted-foreground">
					· <LocalTime at={item.at}>{formatTime(item.at)}</LocalTime>
				</span>
			}
		>
			{item.message ? (
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{item.message}
				</p>
			) : null}
		</ResultCard>
	);
}
