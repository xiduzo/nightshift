import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";

/**
 * Over the canvas after a test run starts: the nodes show what that run
 * gives, until you go back to the newest runs.
 */
export function FollowingBar({
	runId,
	onShowNewest,
	className,
}: {
	runId: string;
	onShowNewest: () => void;
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
				<ItemTitle>The nodes show your test run</ItemTitle>
			</ItemContent>
			<ItemActions>
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={<Link to="/runs/$runId" params={{ runId }} />}
				>
					Open the run
					<ArrowUpRightIcon data-icon="inline-end" />
				</Button>
				<Button variant="outline" size="sm" onClick={onShowNewest}>
					Show the newest runs
				</Button>
			</ItemActions>
		</Item>
	);
}
