/** The item of a Since last run step: how much of what it saw is new, changed and the same. */
import { DiffIcon } from "lucide-react";
import type { SinceLastRunItem } from "../transcript-items";
import { ResultCard } from "./parts";

/** The counts in words: "2 new, 1 changed, 5 the same". */
function sinceLastRunWords(item: SinceLastRunItem): string {
	return `${item.new} new, ${item.changed} changed, ${item.same} the same`;
}

/** What the step found, and whether it remembered anything before. */
export function SinceLastRunCard({ item }: { item: SinceLastRunItem }) {
	const found = item.new > 0 || item.changed > 0;
	return (
		<ResultCard
			icon={DiffIcon}
			kicker="Since last run ·"
			value={sinceLastRunWords(item)}
			tone={found ? "text-status-finished" : "text-muted-foreground"}
		>
			{!item.remembers ? (
				<p className="leading-relaxed">
					A run without a saved flow remembers nothing.
				</p>
			) : item.firstRun ? (
				<p className="leading-relaxed">
					First run: it remembered nothing yet. The next run compares with this
					one.
				</p>
			) : null}
		</ResultCard>
	);
}
