import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import {
	CircleAlertIcon,
	MonitorSmartphoneIcon,
	UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { projectQueries } from "@/features/projects";
import { spaceQueries } from "@/features/spaces";
import type { RunSummary } from "@/shared/api";
import { useNow } from "@/shared/format";
import { SiteHeader } from "@/shared/page";
import { PanelHeader } from "@/shared/panel";
import { PrototypeSwitcher } from "@/shared/prototype-switcher";
import { ComputerDetail } from "./computer-detail";
import {
	ComputerListItem,
	DevicesGroup,
	type DevicesSelection,
	HostListItem,
	PhoneListItem,
} from "./devices-list";
import { HostDetail } from "./host-detail";
import { MergePersonalAlert } from "./merge-personal";
import { HostSpacesAlert, hostKeptSpaces } from "./open-space";
import { PairDeviceDialog } from "./pair-device-dialog";
import { PhoneDetail } from "./phone-detail";
import { DEVICES_VARIANTS, DevicesVariant } from "./prototype-layout/variants";
import { deviceQueries, runQueries } from "./queries";
import { spaceView } from "./space-view";

const ON_THEIR_WAY = new Set(["running", "waiting", "sleeping"]);
/** The `device` of a phone in the address: `phone:<id>`. */
const PHONE = "phone:";

/**
 * The Devices page shows the Space you work in: the Host that keeps it,
 * your computers in it, and the computers of its other members. The list
 * sits in a card on the right. The one you pick
 * opens on the left. This computer's own settings are on the Settings page.
 *
 * `selected` is "host", "phone:<id>" or a computer's id: nothing chosen
 * opens this computer. Your phones sit under the Host: a phone signs in
 * to a Host, not to a Space. `pair` is a code from the link a device
 * printed: it opens "Pair a device" with it. `onPairClosed` takes the
 * code out of the address.
 */
export function DevicesPage({
	selected,
	variant = "A",
	onSelect,
	pair,
	onPairClosed,
}: {
	selected: string | undefined;
	/** PROTOTYPE, throw away: which shape of the page. */
	variant?: string;
	onSelect: (selected: string) => void;
	pair: string | undefined;
	onPairClosed: () => void;
}) {
	const overview = useQuery(deviceQueries.overviewLive());
	const spaceDevices = useQuery(deviceQueries.spaceLive());
	const spaces = useQuery(spaceQueries.list());
	// Only the runs on their way: Night Shift filters them, not every run of the Space.
	const runs = useQuery(runQueries.open());
	const projects = useQuery(projectQueries.list());
	const phones = useQuery(deviceQueries.phonesLive());
	const now = useNow(30_000);
	const [pairing, setPairing] = useState(false);
	const pairOpen = pairing || pair !== undefined;

	const space = spaces.data?.spaces.find((s) => s.id === spaces.data?.active);
	const computer = overview.data?.thisComputer ?? null;
	const view = useMemo(
		() =>
			space
				? spaceView({
						spaceId: space.id,
						personal: space.personal,
						thisComputer: computer,
						paired: overview.data?.devices ?? [],
						devices: spaceDevices.data ?? [],
					})
				: null,
		[space, computer, overview.data?.devices, spaceDevices.data],
	);

	const runsOn = useMemo(() => {
		const on = new Map<string, RunSummary[]>();
		for (const run of runs.data ?? []) {
			if (!ON_THEIR_WAY.has(run.status)) continue;
			on.set(run.device.id, [...(on.get(run.device.id) ?? []), run]);
		}
		return on;
	}, [runs.data]);
	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);

	const all = view ? [...view.yours, ...view.members] : [];
	const phoneId = selected?.startsWith(PHONE)
		? selected.slice(PHONE.length)
		: null;
	const openedPhone = phoneId
		? phones.data?.find((p) => p.id === phoneId)
		: undefined;
	const selection: DevicesSelection =
		selected === "host"
			? { kind: "host" }
			: openedPhone
				? { kind: "phone", id: openedPhone.id }
				: {
						kind: "computer",
						id: all.some((c) => c.id === selected)
							? (selected as string)
							: (view?.yours[0]?.id ?? ""),
					};
	const opened =
		selection.kind === "computer"
			? all.find((c) => c.id === selection.id)
			: undefined;
	const hostName = !view
		? ""
		: view.host.kind === "linked"
			? view.host.host.name
			: (view.host.computer?.name ?? "this computer");
	// A phone signs in to a Host only: here, only while this computer is one.
	const phonesHere =
		view?.host.kind === "linked" || computer?.host.enabled === true;
	// A Space this computer keeps: point to the Spaces its Hosts keep.
	const elsewhere =
		view?.host.kind === "this-computer" && computer
			? hostKeptSpaces(computer.hosts)
			: [];
	// Pairing joins this computer as a Host: only where it keeps the Space.
	const canPair =
		view?.host.kind === "this-computer" &&
		computer?.host.enabled === true &&
		space?.personal === true;

	function setPairOpen(next: boolean) {
		setPairing(next);
		if (!next && pair !== undefined) onPairClosed();
	}

	const error = overview.error ?? spaceDevices.error ?? spaces.error;
	const loading =
		overview.isPending || spaceDevices.isPending || spaces.isPending;

	// PROTOTYPE, throw away: the other shapes of the page get the same data.
	if (variant !== "A") {
		const picked =
			selected !== undefined &&
			(selected === "host" ||
				openedPhone !== undefined ||
				opened !== undefined);
		const detail =
			!picked || !view || !space ? null : selection.kind === "host" ? (
				<HostDetail
					host={view.host}
					space={space}
					onPair={canPair ? () => setPairOpen(true) : undefined}
				/>
			) : selection.kind === "phone" && openedPhone ? (
				<PhoneDetail
					key={openedPhone.id}
					phone={openedPhone}
					hostName={hostName}
				/>
			) : opened ? (
				<ComputerDetail
					key={opened.id}
					computer={opened}
					space={space}
					runs={runsOn.get(opened.id) ?? []}
					projectNames={projectNames}
				/>
			) : null;
		const detailLabel =
			selection.kind === "host"
				? hostName
				: selection.kind === "phone"
					? (openedPhone?.name ?? "Phone")
					: (opened?.name ?? "Computer");
		return (
			<>
				<DevicesVariant
					variant={variant}
					loading={loading}
					error={error && !view ? error : null}
					space={space}
					view={view}
					phones={phones.data ?? []}
					phonesPending={phones.isPending}
					phonesHere={phonesHere}
					hostName={hostName}
					runsOn={runsOn}
					now={now}
					canPair={canPair}
					onPair={() => setPairOpen(true)}
					detail={detail}
					detailLabel={detailLabel}
					selected={picked ? selected : undefined}
					elsewhere={
						elsewhere.length > 0 ? <HostSpacesAlert spaces={elsewhere} /> : null
					}
				/>
				<PairDeviceDialog
					open={pairOpen}
					onOpenChange={setPairOpen}
					initialCode={pair}
				/>
				<PrototypeSwitcher variants={DEVICES_VARIANTS} current={variant} />
			</>
		);
	}

	return (
		<>
			<SiteHeader crumbs={[{ label: "Devices" }]} />
			<div className="flex h-[calc(100svh-3.5rem)] min-h-0">
				<div className="min-w-0 flex-1 overflow-y-auto">
					<MergePersonalAlert />
					{elsewhere.length > 0 ? (
						<div className="mx-auto w-full max-w-6xl px-4 pt-8 md:px-8">
							<HostSpacesAlert spaces={elsewhere} />
						</div>
					) : null}
					{error && !view ? (
						<div className="p-8">
							<Alert variant="destructive">
								<CircleAlertIcon />
								<AlertTitle>The devices did not load</AlertTitle>
								<AlertDescription>{error.message}</AlertDescription>
								<AlertAction>
									<Button
										variant="outline"
										size="sm"
										disabled={overview.isFetching}
										onClick={() => {
											void overview.refetch();
											void spaceDevices.refetch();
											void spaces.refetch();
										}}
									>
										{overview.isFetching ? (
											<Spinner data-icon="inline-start" />
										) : null}
										Try again
									</Button>
								</AlertAction>
							</Alert>
						</div>
					) : loading || !view || !space ? (
						<div
							className="mx-auto flex max-w-6xl flex-col gap-6 p-8"
							aria-hidden
						>
							<Skeleton className="h-12 w-72" />
							<Skeleton className="h-40 w-full" />
							<Skeleton className="h-40 w-full" />
						</div>
					) : selection.kind === "host" ? (
						<HostDetail
							host={view.host}
							space={space}
							onPair={canPair ? () => setPairOpen(true) : undefined}
						/>
					) : selection.kind === "phone" && openedPhone ? (
						<PhoneDetail
							key={openedPhone.id}
							phone={openedPhone}
							hostName={hostName}
						/>
					) : opened ? (
						<ComputerDetail
							key={opened.id}
							computer={opened}
							space={space}
							runs={runsOn.get(opened.id) ?? []}
							projectNames={projectNames}
						/>
					) : null}
				</div>

				<aside className="w-80 shrink-0 p-3 lg:p-4 lg:pl-2">
					<Card className="h-full gap-0 py-0">
						<ScrollArea className="h-full min-h-0">
							<PanelHeader
								icon={space?.personal ? MonitorSmartphoneIcon : UsersIcon}
								kicker="Devices"
								title={space?.name ?? "Devices"}
								mono={false}
							/>
							{view ? (
								<nav aria-label="Devices" className="flex flex-col">
									<DevicesGroup title="Host" count={1}>
										<HostListItem
											host={view.host}
											selected={selection.kind === "host"}
											onClick={() => onSelect("host")}
										/>
									</DevicesGroup>
									<DevicesGroup
										title="Your phones"
										count={phones.data?.length ?? 0}
									>
										{phones.data && phones.data.length > 0 ? (
											phones.data.map((phone) => (
												<PhoneListItem
													key={phone.id}
													phone={phone}
													now={now}
													selected={openedPhone?.id === phone.id}
													onClick={() => onSelect(`${PHONE}${phone.id}`)}
												/>
											))
										) : (
											<p className="px-2.5 py-2 text-muted-foreground text-xs">
												{phones.isPending
													? "Loading."
													: phones.error
														? `${hostName} does not answer now.`
														: phonesHere
															? `Sign in to ${hostName} in the Night Shift app on your phone, and turn on its notifications.`
															: "A phone signs in to a Host. Turn on Be a Host in Settings, or open a Space of a Host you joined."}
											</p>
										)}
									</DevicesGroup>
									<DevicesGroup
										title={
											space?.personal
												? "Your computers"
												: "Your computers in this Space"
										}
										count={view.yours.length}
										add={
											canPair
												? {
														label: "Pair a device",
														onClick: () => setPairOpen(true),
													}
												: undefined
										}
									>
										{view.yours.map((c) => (
											<ComputerListItem
												key={c.id}
												computer={c}
												runningHere={
													(runsOn.get(c.id) ?? []).filter(
														(r) => r.status === "running",
													).length
												}
												selected={opened?.id === c.id}
												onClick={() => onSelect(c.id)}
											/>
										))}
									</DevicesGroup>
									{space?.personal ? null : (
										<DevicesGroup
											title="Members' computers"
											count={view.members.length}
										>
											{view.members.length === 0 ? (
												<p className="px-2.5 py-2 text-muted-foreground text-xs">
													A member's computer shows here once it has a copy of a
													project of this Space, or offers a profile to it.
												</p>
											) : (
												view.members.map((c) => (
													<ComputerListItem
														key={c.id}
														computer={c}
														runningHere={
															(runsOn.get(c.id) ?? []).filter(
																(r) => r.status === "running",
															).length
														}
														selected={opened?.id === c.id}
														onClick={() => onSelect(c.id)}
													/>
												))
											)}
										</DevicesGroup>
									)}
								</nav>
							) : null}
						</ScrollArea>
					</Card>
				</aside>
			</div>
			<PairDeviceDialog
				open={pairOpen}
				onOpenChange={setPairOpen}
				initialCode={pair}
			/>
			<PrototypeSwitcher variants={DEVICES_VARIANTS} current={variant} />
		</>
	);
}
