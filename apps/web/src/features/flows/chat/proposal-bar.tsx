import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { cn } from "@nightshift/ui/lib/utils";

/**
 * Over the canvas while it shows a proposal: what the marks mean, and the
 * way back to the draft. Apply and Discard stay on the proposal in the chat.
 */
export function ProposalBar({
	onHide,
	className,
}: {
	onHide: () => void;
	className?: string;
}) {
	return (
		<Item
			variant="outline"
			size="sm"
			role="status"
			className={cn("flex-nowrap bg-background shadow-lg", className)}
		>
			<ItemContent className="min-w-0">
				<ItemTitle>You see the proposed change</ItemTitle>
				<ItemDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<span className="flex items-center gap-1.5">
						<span
							aria-hidden="true"
							className="size-2.5 rounded-full border-2 border-status-finished"
						/>
						New
					</span>
					<span className="flex items-center gap-1.5">
						<span
							aria-hidden="true"
							className="size-2.5 rounded-full bg-status-waiting"
						/>
						Changed
					</span>
					<span className="flex items-center gap-1.5">
						<span
							aria-hidden="true"
							className="size-2.5 rounded-full border border-muted-foreground border-dashed"
						/>
						Removed
					</span>
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button variant="outline" size="sm" onClick={onHide}>
					Show my flow
				</Button>
			</ItemActions>
		</Item>
	);
}
