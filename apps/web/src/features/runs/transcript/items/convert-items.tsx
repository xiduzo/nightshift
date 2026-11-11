/** The item of a Convert step: what it converted, or why it could not. */
import { CONVERT_FORMAT_LABEL } from "@nightshift/flows";
import { ArrowRightLeftIcon } from "lucide-react";
import { formatSize } from "@/shared/format";
import type { ConvertItem } from "../transcript-items";
import { ResultCard } from "./parts";

/** A format's name as a person reads it, from the id the step logged. */
export function convertFormatLabel(format: string): string {
	return Object.hasOwn(CONVERT_FORMAT_LABEL, format)
		? CONVERT_FORMAT_LABEL[format as keyof typeof CONVERT_FORMAT_LABEL]
		: format;
}

export function ConvertCard({ item }: { item: ConvertItem }) {
	const failed = item.problem !== null;
	return (
		<ResultCard
			icon={ArrowRightLeftIcon}
			kicker={failed ? "Could not convert ·" : "Converted ·"}
			value={`${convertFormatLabel(item.from)} to ${convertFormatLabel(item.to)}`}
			tone={failed ? "text-status-failed" : "text-status-finished"}
			extra={
				<span className="text-muted-foreground tabular-nums">
					{formatSize(item.bytes)}
				</span>
			}
		>
			{failed ? (
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{item.problem}
				</p>
			) : null}
		</ResultCard>
	);
}
