/** The read-only sections of an Agent Profile: where flows use it, and the Spaces it is offered to. */
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { ShareIcon, WorkflowIcon } from "lucide-react";
import type { OfferView, ProfileRow } from "@/shared/api";
import { DetailSection } from "@/shared/detail";
import { permissionLabel } from "./agent-options";

/** The Agent nodes that use the profile, by flow. */
export function ProfileUsedIn({ usedBy }: { usedBy: ProfileRow["usedBy"] }) {
	return (
		<DetailSection
			title="Used in flows"
			description="Agent nodes that use this profile. Your changes apply from their next run."
		>
			{usedBy.length === 0 ? (
				<p className="text-muted-foreground text-sm">No flow uses it yet.</p>
			) : (
				<ItemGroup className="gap-1">
					{usedBy.map((use) => (
						<Item
							key={`${use.projectId}/${use.flowName}`}
							size="xs"
							variant="outline"
							render={
								<Link
									to="/projects/$projectId/flows/$name"
									params={{ projectId: use.projectId, name: use.flowName }}
								/>
							}
						>
							<ItemMedia variant="icon">
								<WorkflowIcon />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>
									<span className="text-muted-foreground">
										{use.projectName} /
									</span>
									<span className="font-mono">{use.flowName}</span>
								</ItemTitle>
								<ItemDescription className="font-mono text-xs">
									{use.nodeIds.join(", ")}
								</ItemDescription>
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			)}
		</DetailSection>
	);
}

/** The Spaces the profile is offered to, with a way to offer or withdraw it. */
export function ProfileOffers({
	offered,
	onOffer,
	onWithdraw,
}: {
	offered: OfferView[];
	onOffer: () => void;
	onWithdraw: (offer: OfferView) => void;
}) {
	return (
		<DetailSection
			title="Offered to Spaces"
			description="People in these Spaces can run this profile on this computer, with your login and your tools."
		>
			{offered.length === 0 ? (
				<div className="flex flex-wrap items-center gap-3">
					<p className="text-muted-foreground text-sm">Only you run it.</p>
					<Button variant="outline" size="sm" onClick={onOffer}>
						<ShareIcon data-icon="inline-start" />
						Offer to a Space…
					</Button>
				</div>
			) : (
				<ItemGroup className="gap-1">
					{offered.map((offer) => (
						<Item key={offer.spaceId} size="xs" variant="outline">
							<ItemContent>
								<ItemTitle>
									{offer.spaceName}
									{offer.listed ? null : (
										<Badge variant="outline">Withdrawn in the Space</Badge>
									)}
								</ItemTitle>
								<ItemDescription className="text-xs">
									{permissionLabel(offer.permissionCap)} at most.{" "}
									{offer.sessionCap === 1
										? "One session at once."
										: `${offer.sessionCap} sessions at once.`}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<Button
									variant="outline"
									size="sm"
									onClick={() => onWithdraw(offer)}
								>
									Withdraw
								</Button>
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			)}
		</DetailSection>
	);
}
