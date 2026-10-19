import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	HouseIcon,
	LaptopIcon,
	LinkIcon,
	MonitorSmartphoneIcon,
	PlusIcon,
	ServerIcon,
} from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { JoinHostDialog } from "@/components/devices/join-host-dialog";
import { PairDeviceDialog } from "@/components/devices/pair-device-dialog";
import { platformName } from "@/components/devices/platform";
import { ThisComputerCard } from "@/components/devices/this-computer-card";
import { PageHeading, PageSection } from "@/components/page-heading";
import { SiteHeader } from "@/components/site-header";
import { useNow } from "@/hooks/use-now";
import type { LinkedHost, PairedDevice } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/devices")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	/** `pair`: a code from the link a device printed; opens "Pair a device" with it. */
	validateSearch: (search: Record<string, unknown>): { pair?: string } =>
		typeof search.pair === "string" ? { pair: search.pair } : {},
	component: DevicesRoute,
});

function DevicesRoute() {
	const { pair } = Route.useSearch();
	const navigate = Route.useNavigate();
	const overview = useQuery({
		...orpc.devices.list.queryOptions(),
		refetchInterval: 5_000,
		meta: { quietRefetchErrors: true },
	});
	const computer = overview.data?.thisComputer ?? null;
	const isHost = computer ? computer.host.enabled : true;
	const [pairing, setPairing] = useState(false);
	const open = pairing || pair !== undefined;

	function setOpen(next: boolean) {
		setPairing(next);
		if (!next && pair !== undefined) {
			void navigate({ search: {}, replace: true });
		}
	}

	const pairButton = (
		<Button size="sm" onClick={() => setOpen(true)} disabled={!isHost}>
			<PlusIcon data-icon="inline-start" />
			Pair a device
		</Button>
	);

	return (
		<>
			<SiteHeader crumbs={[{ label: "Devices" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="w-full max-w-4xl">
					<PageHeading
						title="Devices"
						description="The computers that run Night Shift for you, and how they connect."
						actions={pairButton}
					/>
				</div>
				<div className="flex w-full max-w-4xl flex-col gap-6">
					{overview.isLoading ? (
						<>
							<Skeleton className="h-72 w-full rounded-xl" />
							<Skeleton className="h-32 w-full rounded-xl" />
						</>
					) : overview.error && !overview.data ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>The devices did not load</AlertTitle>
							<AlertDescription>{overview.error.message}</AlertDescription>
							<AlertAction>
								<Button
									variant="outline"
									size="sm"
									disabled={overview.isFetching}
									onClick={() => void overview.refetch()}
								>
									{overview.isFetching ? (
										<Spinner data-icon="inline-start" />
									) : null}
									Try again
								</Button>
							</AlertAction>
						</Alert>
					) : (
						<>
							{computer ? (
								<PageSection
									title="This computer"
									description="Its name, where it keeps its data, and whether other computers can pair with it."
								>
									<ThisComputerCard computer={computer} />
								</PageSection>
							) : null}
							<PairedDevices
								devices={overview.data?.devices ?? []}
								isHost={isHost}
								onPair={() => setOpen(true)}
							/>
							{computer ? <Hosts hosts={computer.hosts} /> : null}
						</>
					)}
				</div>
			</div>
			<PairDeviceDialog open={open} onOpenChange={setOpen} initialCode={pair} />
		</>
	);
}

/** The Person's computers paired with this one, with Remove access. */
function PairedDevices({
	devices,
	isHost,
	onPair,
}: {
	devices: PairedDevice[];
	isHost: boolean;
	onPair: () => void;
}) {
	const now = useNow(30_000);
	const queryClient = useQueryClient();
	const [toRemove, setToRemove] = useState<PairedDevice | null>(null);
	const revoke = useMutation(
		orpc.devices.revoke.mutationOptions({
			onSuccess: () => {
				toast.success(`${toRemove?.name ?? "The device"} has no access now`);
				setToRemove(null);
				void queryClient.invalidateQueries({
					queryKey: orpc.devices.list.key(),
				});
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);

	return (
		<PageSection
			title="Your devices"
			description="Your other computers that sync with this one."
		>
			<Card>
				<CardContent>
					{devices.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MonitorSmartphoneIcon />
								</EmptyMedia>
								<EmptyTitle>No devices yet</EmptyTitle>
								<EmptyDescription>
									{isHost
										? "Pair another computer to run Night Shift on more than one. It shows a code, and you enter it here."
										: "Turn on Be a Host above to let your other computers pair with this one."}
								</EmptyDescription>
							</EmptyHeader>
							{isHost ? (
								<EmptyContent>
									<Button variant="outline" size="sm" onClick={onPair}>
										<PlusIcon data-icon="inline-start" />
										Pair a device
									</Button>
								</EmptyContent>
							) : null}
						</Empty>
					) : (
						<ItemGroup>
							{devices.map((device, index) => (
								<Fragment key={device.id}>
									{index > 0 ? <ItemSeparator /> : null}
									<Item size="sm" className="px-0">
										<ItemMedia variant="icon">
											<LaptopIcon aria-hidden="true" />
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle>
												{device.name}
												<DeviceStatus device={device} />
											</ItemTitle>
											<ItemDescription className="line-clamp-none">
												{platformName(device.platform)}.{" "}
												{device.revokedAt
													? "It can no longer sync with this computer."
													: device.online
														? "Connected now."
														: device.lastSeenAt
															? `Last seen ${formatRelative(device.lastSeenAt, now)}.`
															: "Not connected yet."}{" "}
												{device.homeHost !== null && !device.revokedAt
													? "Its settings are kept here."
													: null}
											</ItemDescription>
										</ItemContent>
										{device.revokedAt ? null : (
											<ItemActions>
												<Button
													variant="outline"
													size="sm"
													onClick={() => setToRemove(device)}
												>
													Remove access
												</Button>
											</ItemActions>
										)}
									</Item>
								</Fragment>
							))}
						</ItemGroup>
					)}
				</CardContent>
			</Card>
			<AlertDialog
				open={toRemove !== null}
				onOpenChange={(open) => {
					if (!open) setToRemove(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove access for {toRemove?.name}?
						</AlertDialogTitle>
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
							onClick={() => {
								if (toRemove) revoke.mutate({ deviceId: toRemove.id });
							}}
						>
							{revoke.isPending ? <Spinner data-icon="inline-start" /> : null}
							Remove access
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageSection>
	);
}

function DeviceStatus({ device }: { device: PairedDevice }) {
	if (device.revokedAt) return <Badge variant="outline">Access removed</Badge>;
	return device.online ? (
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
	);
}

/** The Hosts this computer paired with: its home Host and its guest Hosts. */
function Hosts({ hosts }: { hosts: LinkedHost[] }) {
	const [joining, setJoining] = useState(false);
	const hasHome = hosts.some(
		(host) => host.role === "home" && host.status !== "revoked",
	);
	const joinButton = (
		<Button variant="outline" size="sm" onClick={() => setJoining(true)}>
			<LinkIcon data-icon="inline-start" />
			Join a Host
		</Button>
	);
	return (
		<PageSection
			title="Hosts of this computer"
			description="The computers this one syncs with. Its home Host keeps its settings. A guest Host gets shared Spaces only."
			actions={hosts.length > 0 ? joinButton : undefined}
		>
			<Card>
				<CardContent>
					{hosts.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<ServerIcon />
								</EmptyMedia>
								<EmptyTitle>This computer works on its own</EmptyTitle>
								<EmptyDescription>
									Join a Host to sync this computer with your other computers,
									or with a colleague's Night Shift.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>{joinButton}</EmptyContent>
						</Empty>
					) : (
						<ItemGroup>
							{hosts.map((host, index) => (
								<Fragment key={host.hostId}>
									{index > 0 ? <ItemSeparator /> : null}
									<Item size="sm" className="px-0">
										<ItemMedia variant="icon">
											{host.role === "home" ? (
												<HouseIcon aria-hidden="true" />
											) : (
												<LinkIcon aria-hidden="true" />
											)}
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle>
												{host.name}
												<Badge variant="secondary">
													{host.role === "home" ? "Home Host" : "Guest Host"}
												</Badge>
												<HostStatus host={host} />
											</ItemTitle>
											<ItemDescription className="truncate">
												{host.status === "revoked"
													? "The Host removed the access of this computer. Pair it again to sync."
													: host.address
														? `Connected at ${host.address}.`
														: `Tries ${host.addresses.join(", ")}.`}
											</ItemDescription>
										</ItemContent>
									</Item>
								</Fragment>
							))}
						</ItemGroup>
					)}
				</CardContent>
			</Card>
			<JoinHostDialog
				open={joining}
				onOpenChange={setJoining}
				hasHome={hasHome}
			/>
		</PageSection>
	);
}

function HostStatus({ host }: { host: LinkedHost }) {
	switch (host.status) {
		case "online":
			return (
				<Badge
					variant="outline"
					className="border-status-finished/40 bg-status-finished/10 text-status-finished"
				>
					Online
				</Badge>
			);
		case "connecting":
			return <Badge variant="outline">Connecting</Badge>;
		case "revoked":
			return <Badge variant="outline">Access removed</Badge>;
		default:
			return (
				<Badge variant="outline" className="text-muted-foreground">
					Offline
				</Badge>
			);
	}
}
