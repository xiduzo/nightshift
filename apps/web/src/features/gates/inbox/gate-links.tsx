import type { GateLink } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleDotIcon,
	ExternalLinkIcon,
	GitPullRequestIcon,
	GlobeIcon,
	type LucideIcon,
	TicketIcon,
} from "lucide-react";

const ICONS: Record<GateLink["kind"], LucideIcon> = {
	pull: GitPullRequestIcon,
	issue: CircleDotIcon,
	ticket: TicketIcon,
	web: GlobeIcon,
};

/**
 * The links of a Gate's question as a row of small buttons, right above
 * the answer: what you check before you decide. Each opens in a new tab.
 */
export function GateLinks({
	links,
	className,
}: {
	links: readonly GateLink[];
	className?: string;
}) {
	return (
		<div className={cn("flex flex-wrap gap-1.5", className)}>
			{links.map((link) => {
				const Icon = ICONS[link.kind];
				return (
					<Button
						key={link.url}
						variant="outline"
						size="xs"
						title={link.url}
						nativeButton={false}
						render={<a href={link.url} target="_blank" rel="noreferrer" />}
					>
						<Icon data-icon="inline-start" />
						{link.label}
						<span className="font-mono text-muted-foreground">
							{link.short}
						</span>
						<ExternalLinkIcon
							data-icon="inline-end"
							className="text-muted-foreground"
							aria-label="Opens in a new tab"
						/>
					</Button>
				);
			})}
		</div>
	);
}
