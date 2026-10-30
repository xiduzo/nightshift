import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent, CardHeader } from "@nightshift/ui/components/card";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { projectQueries } from "@/features/projects";
import { spaceQueries } from "@/features/spaces";
import type { RunSummary } from "@/shared/api";
import { useNow } from "@/shared/format";
import { PageHeading, SiteHeader } from "@/shared/page";
import { ComputerCard } from "./computer-card";
import { ComputerDetail } from "./computer-detail";
import { HostCard } from "./host-card";
import { HostDetail } from "./host-detail";
import { JoinHostDialog } from "./join-host-dialog";
import { MergePersonalAlert } from "./merge-personal";
import { ComputerNudge, NextStepCard, type StepsInput } from "./next-step";
import { HostSpacesAlert, hostKeptSpaces } from "./open-space";
import { PairDeviceDialog } from "./pair-device-dialog";
import { PhoneDetail } from "./phone-detail";
import { PhoneHowToDialog } from "./phone-how-to";
import { deviceQueries, runQueries } from "./queries";
import { spaceView } from "./space-view";

const ON_THEIR_WAY = new Set(["running", "waiting", "sleeping"]);
/** The `device` of a phone in the address: `phone:<id>`. */
const PHONE = "phone:";

/**
 * The Devices page shows the Space you work in: the Host that keeps it
 * with your phones on it, then the computers of the Space as cards, with
 * what runs on each now. A card on top leads to the next step that makes
 * the Space work across devices. This computer's own settings are on the
 * Settings page.
 *
 * `selected` is "host", "phone:<id>" or a computer's id: it opens that
 * device's detail in a sheet over the page. `pair` is a code from the link
 * a device printed: it opens "Pair a device" with it. `onPairClosed` takes
 * the code out of the address.
 */
export function DevicesPage({
	selected,
	onSelect,
	pair,
	onPairClosed,
}: {
	selected: string | undefined;
	onSelect: (selected: string | undefined) => void;
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
	const [phoneHowTo, setPhoneHowTo] = useState(false);
	const [joining, setJoining] = useState(false);
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

	const computers = view ? [...view.yours, ...view.members] : [];
	const openedPhone = selected?.startsWith(PHONE)
		? phones.data?.find((p) => p.id === selected.slice(PHONE.length))
		: undefined;
	const opened = computers.find((c) => c.id === selected);
	const hostName = !view
		? ""
		: view.host.kind === "linked"
			? view.host.host.name
			: (view.host.computer?.name ?? "this computer");
	// Where a phone signs in: the Space's Host, while it is one.
	const phoneAddress =
		view?.host.kind === "linked"
			? (view.host.host.address ?? view.host.host.addresses[0])
			: computer?.host.enabled
				? computer.host.addresses[0]
				: undefined;
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

	const steps: StepsInput | null =
		view && space
			? {
					space,
					view,
					phones: phones.data?.length ?? 0,
					beAHost: computer ? computer.host.enabled : null,
					onPair: canPair ? () => setPairOpen(true) : undefined,
					onPhone: () => setPhoneHowTo(true),
					onJoinHost: () => setJoining(true),
				}
			: null;

	const detail =
		!view || !space ? null : selected === "host" ? (
			<HostDetail
				host={view.host}
				space={space}
				onPair={canPair ? () => setPairOpen(true) : undefined}
			/>
		) : openedPhone ? (
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

	return (
		<>
			<SiteHeader crumbs={[{ label: "Devices" }]} />
			<MergePersonalAlert />
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6">
				{error && !view ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Your devices did not load</AlertTitle>
						<AlertDescription>
							{error.message} Check that Night Shift runs on this computer, then
							try again.
						</AlertDescription>
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
				) : loading || !view || !space || !steps ? (
					<DevicesSkeleton />
				) : (
					<>
						{elsewhere.length > 0 ? (
							<HostSpacesAlert spaces={elsewhere} />
						) : null}
						<PageHeading
							title={space.name}
							description={
								space.personal
									? "Your Host keeps your projects and runs. Your computers run the steps."
									: "Its Host keeps the projects and runs. The computers of its members run the steps."
							}
							actions={
								canPair ? (
									<Button
										variant="outline"
										size="sm"
										onClick={() => setPairOpen(true)}
									>
										<PlusIcon data-icon="inline-start" />
										Pair a device
									</Button>
								) : null
							}
						/>
						<NextStepCard key={space.id} {...steps} />
						<HostCard
							host={view.host}
							phones={phones.data}
							phonesError={phones.isError}
							now={now}
							onPhone={() => setPhoneHowTo(true)}
						/>
						<section
							aria-labelledby="devices-computers"
							className="flex flex-col gap-4"
						>
							<h2
								id="devices-computers"
								className="font-semibold text-lg tracking-tight"
							>
								{space.personal ? "Your computers" : "Computers in this Space"}
							</h2>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{computers.map((c) => (
									<ComputerCard
										key={c.id}
										computer={c}
										runs={runsOn.get(c.id) ?? []}
										now={now}
										nudge={<ComputerNudge computer={c} input={steps} />}
									/>
								))}
							</div>
						</section>
					</>
				)}
			</div>

			<Sheet
				open={detail !== null}
				onOpenChange={(open) => {
					if (!open) onSelect(undefined);
				}}
			>
				<SheetContent className="p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
					<SheetTitle className="sr-only">
						{selected === "host"
							? hostName
							: (openedPhone?.name ?? opened?.name ?? "Device")}
					</SheetTitle>
					<ScrollArea className="h-full">{detail}</ScrollArea>
				</SheetContent>
			</Sheet>
			<PairDeviceDialog
				open={pairOpen}
				onOpenChange={setPairOpen}
				initialCode={pair}
			/>
			<PhoneHowToDialog
				open={phoneHowTo}
				onOpenChange={setPhoneHowTo}
				address={phoneAddress}
			/>
			<JoinHostDialog
				open={joining}
				onOpenChange={setJoining}
				hasHome={computer?.hosts.some((h) => h.homeHost) ?? false}
			/>
		</>
	);
}

/** The page's shape while it loads: the heading, the Host, three computers. */
function DevicesSkeleton() {
	return (
		<div className="flex flex-col gap-8" aria-hidden>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96 max-w-full" />
			</div>
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<Skeleton className="size-10 rounded-lg" />
						<div className="flex flex-col gap-2">
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-3 w-64" />
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<Skeleton className="h-8 w-56" />
				</CardContent>
			</Card>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{[0, 1, 2].map((i) => (
					<Card key={i} size="sm">
						<CardHeader>
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-24" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-3 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
