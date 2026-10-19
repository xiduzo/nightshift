import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LaptopIcon, ShareIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { WithdrawOfferDialog } from "@/components/agents/offer-dialog";
import { PageSection } from "@/components/page-heading";
import { RunStatusBadge } from "@/components/run-status-badge";
import { useNow } from "@/hooks/use-now";
import { permissionLabel } from "@/lib/agent-options";
import type { OfferView, SpaceDevice } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";
import { orpc } from "@/utils/orpc";

function caps(offer: Pick<OfferView, "permissionCap" | "sessionCap">): string {
	return `${permissionLabel(offer.permissionCap)} at most. ${
		offer.sessionCap === 1
			? "One session at once."
			: `${offer.sessionCap} sessions at once.`
	}`;
}

/**
 * The profiles this computer offers to Spaces, each with "Runs for
 * <Space>": what other people ran here through it. Withdraw ends it.
 */
export function ThisComputerOffers() {
	const now = useNow(30_000);
	const listed = useQuery({
		...orpc.offers.list.queryOptions(),
		refetchInterval: 10_000,
		meta: { quietRefetchErrors: true },
	});
	const [withdrawing, setWithdrawing] = useState<OfferView | null>(null);
	const offers = listed.data?.offers ?? [];

	return (
		<PageSection
			title="Offered to Spaces"
			description="Profiles of this computer that people in a Space can run here, with your login and your tools."
		>
			<Card>
				<CardContent>
					{listed.isLoading ? (
						<Skeleton className="h-16 w-full" />
					) : offers.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<ShareIcon />
								</EmptyMedia>
								<EmptyTitle>Only you run on this computer</EmptyTitle>
								<EmptyDescription>
									To let people in a shared Space use one of your profiles here,
									open it on the Agents page and choose Offer to a Space.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button
									variant="outline"
									size="sm"
									render={<Link to="/agents" />}
								>
									Open Agents
								</Button>
							</EmptyContent>
						</Empty>
					) : (
						<ItemGroup>
							{offers.map((offer, index) => (
								<Fragment key={`${offer.spaceId}/${offer.profile}`}>
									{index > 0 ? <ItemSeparator /> : null}
									<Item size="sm" className="items-start px-0">
										<ItemContent className="min-w-0">
											<ItemTitle>
												<span className="font-mono">{offer.profile}</span>
												<span className="text-muted-foreground">
													in {offer.spaceName}
												</span>
												{offer.listed ? null : (
													<Badge variant="outline">
														Withdrawn in the Space
													</Badge>
												)}
											</ItemTitle>
											<ItemDescription>{caps(offer)}</ItemDescription>
											<div className="mt-2 flex flex-col gap-1">
												<p className="font-medium text-xs">
													Runs for {offer.spaceName}
												</p>
												{offer.runs.length === 0 ? (
													<p className="text-muted-foreground text-xs">
														Nobody ran it here yet.
													</p>
												) : (
													<ItemGroup className="gap-1">
														{offer.runs.map((run) => (
															<Item key={run.id} size="xs" variant="outline">
																<ItemContent className="min-w-0">
																	<ItemTitle className="truncate">
																		{run.title}
																	</ItemTitle>
																	<ItemDescription className="text-xs">
																		{run.startedBy ?? "Someone"} started it{" "}
																		{formatRelative(run.createdAt, now)}.
																	</ItemDescription>
																</ItemContent>
																<ItemActions>
																	<RunStatusBadge status={run.status} />
																</ItemActions>
															</Item>
														))}
													</ItemGroup>
												)}
											</div>
										</ItemContent>
										<ItemActions>
											<Button
												variant="outline"
												size="sm"
												onClick={() => setWithdrawing(offer)}
											>
												Withdraw
											</Button>
										</ItemActions>
									</Item>
								</Fragment>
							))}
						</ItemGroup>
					)}
				</CardContent>
			</Card>
			<WithdrawOfferDialog
				offer={withdrawing}
				onOpenChange={(open) => {
					if (!open) setWithdrawing(null);
				}}
			/>
		</PageSection>
	);
}

/**
 * The other Devices of the Space you work in, as every Member sees them:
 * the name, whether it is online, which projects it has, and the
 * profiles it offers to the Space. Nothing else of them.
 */
export function SpaceDevices() {
	const listed = useQuery({
		...orpc.devices.space.queryOptions(),
		refetchInterval: 10_000,
		meta: { quietRefetchErrors: true },
	});
	const devices = (listed.data ?? []).filter((d) => !d.thisDevice);
	if (devices.length === 0) return null;
	return (
		<PageSection
			title="Devices in this Space"
			description="The computers that have this Space's projects, and the profiles their owners offer to it."
		>
			<Card>
				<CardContent>
					<ItemGroup>
						{devices.map((device, index) => (
							<Fragment key={device.id}>
								{index > 0 ? <ItemSeparator /> : null}
								<SpaceDeviceItem device={device} />
							</Fragment>
						))}
					</ItemGroup>
				</CardContent>
			</Card>
		</PageSection>
	);
}

function SpaceDeviceItem({ device }: { device: SpaceDevice }) {
	return (
		<Item size="sm" className="px-0">
			<ItemMedia variant="icon">
				<LaptopIcon aria-hidden="true" />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>
					{device.name}
					{device.online === null ? null : device.online ? (
						<Badge
							variant="outline"
							className="border-status-finished/40 bg-status-finished/10 text-status-finished"
						>
							Online
						</Badge>
					) : (
						<Badge variant="outline" className="text-muted-foreground">
							Offline
						</Badge>
					)}
				</ItemTitle>
				<ItemDescription className="line-clamp-none">
					{device.clones.length > 0
						? `Has ${device.clones.map((c) => c.projectName).join(", ")}.`
						: "Has none of this Space's projects."}{" "}
					{device.offers.length > 0 ? null : "Offers nothing to this Space."}
				</ItemDescription>
				{device.offers.map((offer) => (
					<ItemDescription key={offer.profile} className="line-clamp-none">
						Offers <span className="font-mono">{offer.profile}</span>:{" "}
						{caps(offer)}
					</ItemDescription>
				))}
			</ItemContent>
		</Item>
	);
}
