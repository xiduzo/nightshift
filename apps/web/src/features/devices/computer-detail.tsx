import { platformName } from "@nightshift/client";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	LaptopIcon,
	type LucideIcon,
	MonitorIcon,
	PlusIcon,
	ServerIcon,
	SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { permissionLabel, WithdrawOfferDialog } from "@/features/agents";
import { RunStatusBadge } from "@/features/runs/components/run-status-badge";
import type { OfferView, RunSummary } from "@/shared/api";
import { DetailSection, DetailShell } from "@/shared/detail";
import { formatDateTime, formatRelative, useNow } from "@/shared/format";
import { deviceMutations, deviceQueries, offerQueries } from "./queries";
import type { SpaceComputer } from "./space-view";
import { ComputerStatus, computerLine } from "./status-badges";

/** The icon of a computer: a server for Linux, a laptop for macOS and Windows. */
export function computerIcon(platform: string | null): LucideIcon {
	if (platform === "linux") return ServerIcon;
	if (platform === "darwin" || platform === "win32") return LaptopIcon;
	return MonitorIcon;
}

export function caps(offer: Pick<OfferView, "permissionCap" | "sessionCap">) {
	return `${permissionLabel(offer.permissionCap)} at most. ${
		offer.sessionCap === 1
			? "One session at once."
			: `${offer.sessionCap} sessions at once.`
	}`;
}

/**
 * One computer of the Space: what runs on it now, which of the Space's
 * projects it has, and what it offers to the Space. For this computer, also
 * its own Offers and the way to its settings. For one of yours paired here,
 * Remove access.
 */
export function ComputerDetail({
	computer,
	space,
	runs,
	projectNames,
}: {
	computer: SpaceComputer;
	space: { id: string; name: string; personal: boolean };
	/** The Space's runs on their way, on this computer. */
	runs: RunSummary[];
	projectNames: Map<string, string>;
}) {
	const now = useNow(30_000);
	const [removing, setRemoving] = useState(false);
	const Icon = computerIcon(computer.platform);
	const revoked = computer.paired?.revokedAt != null;
	const kicker = computer.thisDevice
		? "This computer"
		: computer.mine
			? "Your computer"
			: computer.owner
				? `${computer.owner}'s computer`
				: "A member's computer";

	return (
		<DetailShell
			icon={<Icon />}
			kicker={kicker}
			title={computer.name}
			subtitle={
				<span className="flex flex-wrap items-center gap-2">
					<ComputerStatus computer={computer} />
					{[
						computer.platform ? `${platformName(computer.platform)}.` : null,
						computerLine(computer, now),
					]
						.filter(Boolean)
						.join(" ")}
				</span>
			}
			actions={
				computer.paired && !revoked
					? [
							{
								label: "Remove access",
								destructive: true,
								onSelect: () => setRemoving(true),
							},
						]
					: undefined
			}
		>
			<DetailSection
				title="Runs here now"
				description={`Runs of ${space.name} with steps on this computer.`}
			>
				{runs.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Nothing runs here now.
					</p>
				) : (
					<ItemGroup className="gap-2">
						{runs.map((run) => (
							<Item
								key={run.id}
								variant="outline"
								size="sm"
								render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
							>
								<ItemContent className="min-w-0">
									<ItemTitle className="max-w-full truncate">
										{run.title}
									</ItemTitle>
									<ItemDescription className="truncate">
										{projectNames.get(run.projectId) ?? "A project"}.{" "}
										{run.startedBy?.name
											? `${run.startedBy.name} started it`
											: "Started"}{" "}
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
			</DetailSection>

			<DetailSection
				title="Projects"
				description={`The projects of ${space.name} it has a copy of.`}
			>
				{computer.clones.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						It has no copy of a project of this Space yet.
					</p>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{computer.clones.map((clone) => (
							<Badge key={clone.projectId} variant="outline">
								{clone.projectName}
							</Badge>
						))}
					</div>
				)}
			</DetailSection>

			{computer.thisDevice && !space.personal ? (
				<ThisComputerOffers spaceId={space.id} />
			) : computer.mine && computer.offers.length === 0 ? null : (
				<DetailSection
					title="Offered to this Space"
					description={
						computer.mine
							? "Profiles members of this Space can run on it."
							: `Profiles ${computer.owner ?? "its owner"} lets members run on it. You see nothing else of this computer.`
					}
				>
					{computer.offers.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{computer.owner ?? "Its owner"} offers nothing on it.
						</p>
					) : (
						<ItemGroup className="gap-2">
							{computer.offers.map((offer) => (
								<Item key={offer.profile} variant="outline" size="sm">
									<ItemContent>
										<ItemTitle className="font-mono">{offer.profile}</ItemTitle>
										<ItemDescription>{caps(offer)}</ItemDescription>
									</ItemContent>
								</Item>
							))}
						</ItemGroup>
					)}
				</DetailSection>
			)}

			{computer.paired ? (
				<DetailSection
					title="Paired"
					description="When it joined this computer."
				>
					<p className="text-sm">
						{revoked
							? "You removed its access. To use it here again, pair it again."
							: `Paired on ${formatDateTime(computer.paired.pairedAt)}.`}{" "}
						{computer.paired.homeHost !== null && !revoked
							? "Its settings are kept on this computer."
							: null}
					</p>
				</DetailSection>
			) : null}

			{computer.thisDevice ? (
				<>
					<DetailSection
						title="Coding agents"
						description="The profiles, harnesses and tools of this computer."
					>
						<Button
							variant="outline"
							size="sm"
							nativeButton={false}
							render={<Link to="/agents" />}
						>
							<BotIcon data-icon="inline-start" />
							Open Agents
						</Button>
					</DetailSection>
					<DetailSection
						title="Settings of this computer"
						description="Be a Host, the Hosts it joined, and where it keeps its data."
					>
						<Button
							variant="outline"
							size="sm"
							nativeButton={false}
							render={<Link to="/settings" hash="this-computer" />}
						>
							<SettingsIcon data-icon="inline-start" />
							Open Settings
						</Button>
					</DetailSection>
				</>
			) : null}

			{computer.paired ? (
				<RemoveAccessDialog
					device={{ id: computer.paired.id, name: computer.name }}
					open={removing}
					onOpenChange={setRemoving}
				/>
			) : null}
		</DetailShell>
	);
}

/** This computer's Offers to the Space, with the runs of others under them. */
function ThisComputerOffers({ spaceId }: { spaceId: string }) {
	const now = useNow(30_000);
	const listed = useQuery(offerQueries.listLive());
	const [withdrawing, setWithdrawing] = useState<OfferView | null>(null);
	const offers = (listed.data?.offers ?? []).filter(
		(o) => o.spaceId === spaceId,
	);
	const canOffer = (listed.data?.spaces ?? []).some((s) => s.id === spaceId);

	return (
		<DetailSection
			title="Offered to this Space"
			description="Profiles members of this Space can run here, with your login and your tools."
		>
			<div className="flex flex-col items-start gap-3">
				{offers.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Only you run on this computer.
					</p>
				) : (
					<ItemGroup className="w-full gap-2">
						{offers.map((offer) => (
							<Item
								key={offer.profile}
								variant="outline"
								size="sm"
								className="items-start"
							>
								<ItemContent className="min-w-0">
									<ItemTitle>
										<span className="font-mono">{offer.profile}</span>
										{offer.listed ? null : (
											<Badge variant="outline">Withdrawn in the Space</Badge>
										)}
									</ItemTitle>
									<ItemDescription>{caps(offer)}</ItemDescription>
									{offer.runs.length === 0 ? (
										<p className="mt-1 text-muted-foreground text-xs">
											Nobody ran it here yet.
										</p>
									) : (
										<ItemGroup className="mt-2 gap-1">
											{offer.runs.map((run) => (
												<Item key={run.id} size="xs" variant="muted">
													<ItemContent className="min-w-0">
														<ItemTitle className="max-w-full truncate">
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
						))}
					</ItemGroup>
				)}
				{canOffer ? (
					<Button
						variant="ghost"
						size="sm"
						nativeButton={false}
						render={<Link to="/agents" />}
					>
						<PlusIcon data-icon="inline-start" />
						Offer a profile
					</Button>
				) : null}
			</div>
			<WithdrawOfferDialog
				offer={withdrawing}
				onOpenChange={(open) => {
					if (!open) setWithdrawing(null);
				}}
			/>
		</DetailSection>
	);
}

function RemoveAccessDialog({
	device,
	open,
	onOpenChange,
}: {
	device: { id: string; name: string };
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const revoke = useMutation(
		deviceMutations.revoke({
			onSuccess: () => {
				toast.success(`${device.name} has no access now`);
				onOpenChange(false);
				void queryClient.invalidateQueries({
					queryKey: deviceQueries.overviewKey(),
				});
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove access for {device.name}?</AlertDialogTitle>
					<AlertDialogDescription>
						It stops syncing with this computer at once. To use it here again,
						pair it again.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={revoke.isPending}
						onClick={() => revoke.mutate({ deviceId: device.id })}
					>
						{revoke.isPending ? <Spinner data-icon="inline-start" /> : null}
						Remove access
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
