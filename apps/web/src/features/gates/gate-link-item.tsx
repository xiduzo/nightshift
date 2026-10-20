import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	CircleDotIcon,
	ExternalLinkIcon,
	GitPullRequestIcon,
	GlobeIcon,
	type LucideIcon,
	TicketIcon,
} from "lucide-react";

import type { GateLink } from "./gate-links";

const ICONS: Record<GateLink["kind"], LucideIcon> = {
	pull: GitPullRequestIcon,
	issue: CircleDotIcon,
	ticket: TicketIcon,
	web: GlobeIcon,
};

/** A link from a Gate's question: what it is and where it lives. Opens in a new tab. */
export function GateLinkItem({ link }: { link: GateLink }) {
	const Icon = ICONS[link.kind];
	return (
		<Item
			variant="outline"
			size="sm"
			render={<a href={link.url} target="_blank" rel="noreferrer" />}
		>
			<ItemMedia variant="icon">
				<Icon />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full min-w-0">
					<span className="truncate">{link.label}</span>
					<span className="shrink-0 font-mono font-normal text-muted-foreground">
						{link.short}
					</span>
				</ItemTitle>
				<ItemDescription className="truncate text-xs" title={link.url}>
					{link.where}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<ExternalLinkIcon
					className="size-3.5 text-muted-foreground"
					aria-label="Opens in a new tab"
				/>
			</ItemActions>
		</Item>
	);
}
