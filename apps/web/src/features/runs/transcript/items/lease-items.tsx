/** The item of a Lease step: it took its lease, or another run holds it. */
import { LockIcon, LockOpenIcon } from "lucide-react";
import type { LeaseItem } from "../transcript-items";
import { ResultCard } from "./parts";

/** The lease the step took, or the run that holds it. */
export function LeaseCard({ item }: { item: LeaseItem }) {
	return (
		<ResultCard
			icon={item.held ? LockIcon : LockOpenIcon}
			kicker={item.held ? "Took the lease ·" : "The lease is busy ·"}
			value={item.name}
			tone={item.held ? "text-status-finished" : "text-muted-foreground"}
		>
			{!item.held && item.holderTitle ? (
				<p className="break-words leading-relaxed">
					The run “{item.holderTitle}” holds it.
				</p>
			) : null}
		</ResultCard>
	);
}
