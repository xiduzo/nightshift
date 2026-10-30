/**
 * PROTOTYPE, throw away. The Host hub (variant C) and three ways to lead
 * the person to their next step:
 *
 * - C: the hub as it was, with nothing but "Pair a device".
 * - C1 Checklist: a "Set up your devices" card on top, with the steps
 *   left and one button each. It goes once every step is done.
 * - C2 Open slots: what is missing sits where it would show, as a dashed
 *   card at the end of the computers and a dashed chip among the phones.
 * - C3 Next step: one card on top with the most useful next step and
 *   "Not now", plus an action on the card of the computer it concerns.
 *
 * Every hub has its own loading skeleton, error and offline Host. The
 * `StateSwitch` in the prototype bar forces a state (`states.ts`).
 */
import { platformName } from "@nightshift/client";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Progress } from "@nightshift/ui/components/progress";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { cn } from "@nightshift/ui/lib/utils";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
	BotIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleIcon,
	CloudOffIcon,
	type LucideIcon,
	MonitorSmartphoneIcon,
	PlusIcon,
	RefreshCwIcon,
	ServerIcon,
	SettingsIcon,
	SmartphoneIcon,
	UserPlusIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { formatRelative } from "@/shared/format";
import { PageHeading, SiteHeader } from "@/shared/page";
import { computerIcon } from "../computer-detail";
import { JoinHostDialog } from "../join-host-dialog";
import type { SpaceComputer, SpaceHost } from "../space-view";
import { ComputerStatus, computerLine } from "../status-badges";
import { DeviceLink, hostInfo, PairButton, PHONE, type Props } from "./parts";
import { applyState, DEVICE_STATES } from "./states";

type Mode = "plain" | "checklist" | "slots" | "next";

const MODES: Record<string, Mode> = {
	C: "plain",
	C1: "checklist",
	C2: "slots",
	C3: "next",
};

/** The prototype bar's second switch: which state of the page. */
export function StateSwitch() {
	const { state } = useSearch({ strict: false }) as { state?: string };
	const navigate = useNavigate();
	return (
		<div className="ml-1 flex items-center gap-0.5 border-zinc-700 border-l pl-2">
			{DEVICE_STATES.map((s) => (
				<button
					key={s.key}
					type="button"
					className={cn(
						"rounded-full px-2 py-1 font-mono text-[11px] text-zinc-400 hover:bg-zinc-800",
						(state ?? "live") === s.key && "bg-fuchsia-500 text-white",
					)}
					onClick={() =>
						void navigate({
							to: ".",
							search: (prev: Record<string, unknown>) => ({
								...prev,
								state: s.key === "live" ? undefined : s.key,
								device: undefined,
							}),
							replace: true,
						})
					}
				>
					{s.name}
				</button>
			))}
		</div>
	);
}

export function DevicesHub(real: Props) {
	const { state } = useSearch({ strict: false }) as { state?: string };
	const props = applyState(real, state);
	const mode = MODES[props.variant] ?? "plain";
	const navigate = useNavigate();
	const [phoneHowTo, setPhoneHowTo] = useState(false);
	const [joining, setJoining] = useState(false);
	const actions: Actions = {
		phone: () => setPhoneHowTo(true),
		join: () => setJoining(true),
	};
	const { view, space } = props;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Devices" }]} />
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6">
				{props.error ? (
					<HubError props={props} />
				) : props.loading || !view || !space ? (
					<HubSkeleton />
				) : (
					<>
						{props.elsewhere}
						<PageHeading
							title={space.name}
							description={
								space.personal
									? "Your Host keeps your projects and runs. Your computers run the steps."
									: "Its Host keeps the projects and runs. The computers of its members run the steps."
							}
							actions={
								props.canPair ? <PairButton onClick={props.onPair} /> : null
							}
						/>
						{mode === "checklist" ? (
							<Checklist props={props} actions={actions} />
						) : null}
						{mode === "next" ? (
							<NextStep props={props} actions={actions} />
						) : null}
						<HostCard
							props={props}
							host={view.host}
							mode={mode}
							actions={actions}
						/>
						<div className="flex flex-col gap-4">
							<h2 className="font-semibold text-lg tracking-tight">
								{space.personal ? "Your computers" : "Computers in this Space"}
							</h2>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{[...view.yours, ...view.members].map((c) => (
									<ComputerCard
										key={c.id}
										computer={c}
										props={props}
										mode={mode}
									/>
								))}
								{mode === "slots" ? (
									<Slots props={props} actions={actions} />
								) : null}
							</div>
							{mode === "plain" &&
							!space.personal &&
							view.members.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									A member's computer shows here once it has a copy of a project
									of this Space, or offers a profile to it.
								</p>
							) : null}
						</div>
					</>
				)}
			</div>
			<Sheet
				open={props.detail !== null}
				onOpenChange={(open) => {
					if (!open)
						void navigate({
							to: "/devices",
							search: { variant: props.variant, state },
						});
				}}
			>
				<SheetContent className="p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
					<SheetTitle className="sr-only">{props.detailLabel}</SheetTitle>
					<ScrollArea className="h-full">{props.detail}</ScrollArea>
				</SheetContent>
			</Sheet>
			<PhoneHowTo
				open={phoneHowTo}
				onOpenChange={setPhoneHowTo}
				props={props}
			/>
			<JoinHostDialog
				open={joining}
				onOpenChange={setJoining}
				hasHome={props.hasHome}
			/>
		</>
	);
}

type Actions = { phone: () => void; join: () => void };

// ─── Steps ───────────────────────────────────────────────────────────────

type Step = {
	key: string;
	Icon: LucideIcon;
	title: string;
	description: string;
	done: boolean;
	action: ReactNode;
	/** Shown under the action, as a way out: "Already have a Host?" */
	alternative?: ReactNode;
};

function SettingsButton({ children }: { children: ReactNode }) {
	return (
		<Button
			size="sm"
			nativeButton={false}
			render={<Link to="/settings" hash="this-computer" />}
		>
			<SettingsIcon data-icon="inline-start" />
			{children}
		</Button>
	);
}

function steps(props: Props, actions: Actions): Step[] {
	const view = props.view;
	const space = props.space;
	if (!view || !space) return [];
	const self = view.yours.find((c) => c.thisDevice);
	const phone: Step = {
		key: "phone",
		Icon: SmartphoneIcon,
		title: "Get Gates on your phone",
		description: "Answer a Gate and follow your runs when you are away.",
		done: props.phones.length > 0,
		action: (
			<Button size="sm" variant="outline" onClick={actions.phone}>
				Show me how
			</Button>
		),
	};
	if (!space.personal) {
		return [
			{
				key: "members",
				Icon: UserPlusIcon,
				title: "Invite a member",
				description: "Their computers can then run the steps of this Space.",
				done: view.members.length > 0,
				action: (
					<Button
						size="sm"
						nativeButton={false}
						render={<Link to="/members" />}
					>
						<UserPlusIcon data-icon="inline-start" />
						Invite a member
					</Button>
				),
			},
			{
				key: "offer",
				Icon: BotIcon,
				title: "Offer a profile to this Space",
				description:
					"Members can then run steps on this computer, with your login and tools.",
				done: (self?.offers.length ?? 0) > 0,
				action: (
					<Button
						size="sm"
						variant="outline"
						nativeButton={false}
						render={<Link to="/agents" />}
					>
						Offer a profile
					</Button>
				),
			},
			phone,
		];
	}
	const hosted =
		view.host.kind === "linked" || (props.beAHost ?? false) === true;
	return [
		{
			key: "host",
			Icon: ServerIcon,
			title: "Let your other devices connect",
			description:
				"Turn on Be a Host. Your other computers and your phone then connect to this computer.",
			done: hosted,
			action: <SettingsButton>Turn on Be a Host</SettingsButton>,
			alternative: (
				<Button variant="link" size="sm" onClick={actions.join}>
					I already have a Host
				</Button>
			),
		},
		{
			key: "computer",
			Icon: PlusIcon,
			title: "Add another computer",
			description:
				"Steps can then run there too, for example on a computer that stays on at night.",
			done: view.yours.length > 1,
			action: props.canPair ? (
				<Button size="sm" variant="outline" onClick={props.onPair}>
					Pair a device
				</Button>
			) : (
				<span className="text-muted-foreground text-xs">
					{hosted
						? `Open Night Shift on the other computer and join ${props.hostName}.`
						: "Turn on Be a Host first."}
				</span>
			),
		},
		phone,
	];
}

// ─── C1: checklist ───────────────────────────────────────────────────────

function Checklist({ props, actions }: { props: Props; actions: Actions }) {
	const all = steps(props, actions);
	const done = all.filter((s) => s.done).length;
	if (done === all.length) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{props.space?.personal
						? "Set up your devices"
						: `Set up ${props.space?.name}`}
				</CardTitle>
				<CardDescription>
					{done} of {all.length} done
				</CardDescription>
				<CardAction className="w-32 self-center">
					<Progress value={(done / all.length) * 100} />
				</CardAction>
			</CardHeader>
			<CardContent>
				<ItemGroup className="gap-2">
					{all.map((step) => (
						<Item
							key={step.key}
							variant={step.done ? "default" : "outline"}
							size="sm"
						>
							<ItemMedia>
								{step.done ? (
									<CircleCheckIcon className="size-5 text-status-finished" />
								) : (
									<CircleIcon className="size-5 text-muted-foreground" />
								)}
							</ItemMedia>
							<ItemContent>
								<ItemTitle
									className={cn(
										step.done && "text-muted-foreground line-through",
									)}
								>
									{step.title}
								</ItemTitle>
								{step.done ? null : (
									<ItemDescription>{step.description}</ItemDescription>
								)}
							</ItemContent>
							{step.done ? null : (
								<ItemActions className="flex-col items-end gap-0">
									{step.action}
									{step.alternative}
								</ItemActions>
							)}
						</Item>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

// ─── C3: next step ───────────────────────────────────────────────────────

function NextStep({ props, actions }: { props: Props; actions: Actions }) {
	const [dismissed, setDismissed] = useState<string[]>([]);
	const host = props.view?.host;
	if (host?.kind === "linked" && host.host.status === "offline") return null;
	const all = steps(props, actions);
	const left = all.filter((s) => !s.done);
	const next = left.find((s) => !dismissed.includes(s.key));
	if (!next) return null;
	return (
		<Card className="bg-muted/40">
			<CardHeader>
				<div className="flex items-start gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border [&_svg]:size-5">
						<next.Icon />
					</div>
					<div className="flex flex-col gap-1">
						<p className="text-muted-foreground text-xs">
							Next step · {all.length - left.length + 1} of {all.length}
						</p>
						<CardTitle>{next.title}</CardTitle>
						<CardDescription>{next.description}</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardFooter className="gap-2">
				{next.action}
				{next.alternative}
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto"
					onClick={() => setDismissed((d) => [...d, next.key])}
				>
					Not now
				</Button>
			</CardFooter>
		</Card>
	);
}

// ─── C2: open slots ──────────────────────────────────────────────────────

function Slot({
	Icon,
	title,
	description,
	action,
}: {
	Icon: LucideIcon;
	title: string;
	description: string;
	action: ReactNode;
}) {
	return (
		<Card
			size="sm"
			className="border border-dashed bg-transparent shadow-none ring-0"
		>
			<CardHeader>
				<div className="flex size-8 items-center justify-center rounded-md bg-muted [&_svg]:size-4">
					<Icon />
				</div>
				<CardTitle className="pt-2">{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardFooter className="mt-auto">{action}</CardFooter>
		</Card>
	);
}

function Slots({ props, actions }: { props: Props; actions: Actions }) {
	const all = steps(props, actions);
	const open = (key: string) => all.find((s) => s.key === key && !s.done);
	const computer = open("computer");
	const host = open("host");
	const members = open("members");
	const offer = open("offer");
	return (
		<>
			{props.space?.personal ? (
				<Slot
					Icon={PlusIcon}
					title="Add a computer"
					description={
						host
							? "Turn on Be a Host first. Then your other computers can connect to this one."
							: "Steps can then run there too, for example on a computer that stays on at night."
					}
					action={
						host ? (
							<div className="flex flex-wrap items-center gap-1">
								{host.action}
								{host.alternative}
							</div>
						) : (
							(computer?.action ?? (
								<Button size="sm" variant="outline" onClick={props.onPair}>
									Pair a device
								</Button>
							))
						)
					}
				/>
			) : null}
			{members ? (
				<Slot
					Icon={UserPlusIcon}
					title="Invite a member"
					description={members.description}
					action={members.action}
				/>
			) : null}
			{offer ? (
				<Slot
					Icon={BotIcon}
					title="Offer this computer"
					description={offer.description}
					action={offer.action}
				/>
			) : null}
		</>
	);
}

// ─── Host card ───────────────────────────────────────────────────────────

function HostCard({
	props,
	host,
	mode,
	actions,
}: {
	props: Props;
	host: SpaceHost;
	mode: Mode;
	actions: Actions;
}) {
	const info = hostInfo(host);
	const offline = host.kind === "linked" && host.host.status === "offline";
	return (
		<Card className={cn(offline && "border-destructive/40")}>
			<CardHeader>
				<div className="flex items-center gap-3">
					<div
						className={cn(
							"flex size-10 items-center justify-center rounded-lg bg-muted [&_svg]:size-5",
							offline && "bg-destructive/10 text-destructive",
						)}
					>
						{offline ? <CloudOffIcon /> : <info.Icon />}
					</div>
					<div className="flex flex-col gap-0.5">
						<CardTitle className="flex items-center gap-2">
							{info.name}
							{info.status}
						</CardTitle>
						<CardDescription>
							Host · {info.role}
							{host.kind === "linked" && host.host.address ? (
								<>
									{" · "}
									<code className="text-xs">{host.host.address}</code>
								</>
							) : null}
						</CardDescription>
					</div>
				</div>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={<DeviceLink device="host" />}
					>
						Open
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{offline && host.kind === "linked" ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Night Shift cannot reach {host.host.name}</AlertTitle>
						<AlertDescription>
							It last answered {formatRelative(host.host.since, props.now)}. New
							runs wait until it is back. Night Shift tries again on its own.
						</AlertDescription>
						<AlertAction>
							<Button
								variant="outline"
								size="sm"
								nativeButton={false}
								render={<Link to="/settings" hash="this-computer" />}
							>
								Check the connection
							</Button>
						</AlertAction>
					</Alert>
				) : null}
				<div className="flex flex-col gap-2">
					<p className="text-muted-foreground text-xs">Your phones on it</p>
					<div className="flex flex-wrap items-center gap-2">
						{props.phones.map((phone) => (
							<Button
								key={phone.id}
								variant="secondary"
								size="sm"
								nativeButton={false}
								render={<DeviceLink device={`${PHONE}${phone.id}`} />}
							>
								<SmartphoneIcon data-icon="inline-start" />
								{phone.name}
								<span className="text-muted-foreground">
									{phone.lastSeenAt
										? formatRelative(phone.lastSeenAt, props.now)
										: platformName(phone.platform)}
								</span>
							</Button>
						))}
						{mode === "slots" ? (
							<Button
								variant="outline"
								size="sm"
								className="border-dashed"
								onClick={actions.phone}
							>
								<PlusIcon data-icon="inline-start" />
								Add your phone
							</Button>
						) : props.phones.length === 0 ? (
							<span className="text-muted-foreground text-sm">
								No phone yet.{" "}
								{mode === "plain" ? null : (
									<Button
										variant="link"
										size="sm"
										className="h-auto p-0"
										onClick={actions.phone}
									>
										Show me how
									</Button>
								)}
							</span>
						) : null}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

// ─── Computer card ───────────────────────────────────────────────────────

function ComputerCard({
	computer,
	props,
	mode,
}: {
	computer: SpaceComputer;
	props: Props;
	mode: Mode;
}) {
	const Icon = computerIcon(computer.platform);
	const runs = props.runsOn.get(computer.id) ?? [];
	const revoked = computer.paired?.revokedAt != null;
	const quiet = revoked || computer.online === false;
	const nudge = mode === "next" ? cardNudge(computer, props) : null;
	return (
		<Card
			size="sm"
			className={cn(
				"relative transition-colors hover:bg-muted/40",
				quiet && "opacity-70",
			)}
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<Icon className="size-4 shrink-0 text-muted-foreground" />
					<Link
						to="/devices"
						search={(prev: Record<string, unknown>) => ({
							...prev,
							device: computer.id,
						})}
						className="truncate after:absolute after:inset-0"
					>
						{computer.name}
					</Link>
				</CardTitle>
				<CardDescription className="truncate">
					{computer.thisDevice
						? "This computer"
						: computer.mine
							? "Yours"
							: (computer.owner ?? "A member")}
					{computer.platform ? ` · ${platformName(computer.platform)}` : ""}
				</CardDescription>
				<CardAction>
					<ComputerStatus computer={computer} />
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-1.5">
				{runs.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{computerLine(computer, props.now)}
					</p>
				) : (
					runs.slice(0, 2).map((run) => (
						<p key={run.id} className="truncate text-sm">
							<span className="mr-1.5 inline-block size-1.5 rounded-full bg-status-running align-middle" />
							{run.title}
						</p>
					))
				)}
				{runs.length > 2 ? (
					<p className="text-muted-foreground text-xs">
						and {runs.length - 2} more
					</p>
				) : null}
			</CardContent>
			<CardFooter className="gap-3 text-muted-foreground text-xs">
				<span>
					{computer.clones.length}{" "}
					{computer.clones.length === 1 ? "project" : "projects"}
				</span>
				<span>
					{computer.offers.length}{" "}
					{computer.offers.length === 1
						? "profile offered"
						: "profiles offered"}
				</span>
				{nudge ? <span className="relative z-10 ml-auto">{nudge}</span> : null}
			</CardFooter>
		</Card>
	);
}

/** C3: the one action a computer's own card offers, when it has one. */
function cardNudge(computer: SpaceComputer, props: Props): ReactNode {
	if (computer.paired?.revokedAt != null && props.canPair)
		return (
			<Button size="xs" variant="outline" onClick={props.onPair}>
				<RefreshCwIcon data-icon="inline-start" />
				Pair again
			</Button>
		);
	if (!computer.thisDevice) return null;
	if (props.space?.personal === false && computer.offers.length === 0)
		return (
			<Button
				size="xs"
				variant="outline"
				nativeButton={false}
				render={<Link to="/agents" />}
			>
				Offer a profile
			</Button>
		);
	if (
		props.space?.personal &&
		props.beAHost === false &&
		props.view?.host.kind !== "linked"
	)
		return (
			<Button
				size="xs"
				variant="outline"
				nativeButton={false}
				render={<Link to="/settings" hash="this-computer" />}
			>
				Be a Host
			</Button>
		);
	return null;
}

// ─── States ──────────────────────────────────────────────────────────────

function HubSkeleton() {
	return (
		<div className="flex flex-col gap-8" aria-hidden>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96" />
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

function HubError({ props }: { props: Props }) {
	return (
		<div className="flex flex-col gap-8">
			<PageHeading title="Devices" />
			<Card className="items-center py-12 text-center">
				<CardHeader className="flex flex-col items-center">
					<div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive [&_svg]:size-6">
						<MonitorSmartphoneIcon />
					</div>
					<CardTitle className="pt-2">Your devices did not load</CardTitle>
					<CardDescription className="max-w-sm">
						{props.error?.message} Check that Night Shift runs on this computer,
						then try again.
					</CardDescription>
				</CardHeader>
				<CardFooter>
					<Button size="sm" onClick={props.onRetry}>
						<RefreshCwIcon data-icon="inline-start" />
						Try again
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}

// ─── Phone how-to ────────────────────────────────────────────────────────

function PhoneHowTo({
	open,
	onOpenChange,
	props,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	props: Props;
}) {
	const host = props.view?.host;
	const address =
		host?.kind === "linked"
			? (host.host.address ?? host.host.addresses[0])
			: host?.computer?.host.addresses[0];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Get Night Shift on your phone</DialogTitle>
					<DialogDescription>
						Your phone shows your runs, and tells you when a Gate waits for you.
					</DialogDescription>
				</DialogHeader>
				{props.phonesHere && address ? (
					<ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
						<li>
							Install the Night Shift app from the App Store or Google Play.
						</li>
						<li>
							Sign in with this address and your account:
							<code className="mt-1 block rounded bg-muted px-2 py-1 text-xs">
								{address}
							</code>
						</li>
						<li>Allow notifications when the app asks.</li>
					</ol>
				) : (
					<Alert>
						<CircleAlertIcon />
						<AlertTitle>Your phone needs a Host</AlertTitle>
						<AlertDescription>
							Turn on Be a Host on this computer first. Your phone then signs in
							to it.
						</AlertDescription>
					</Alert>
				)}
				<DialogFooter>
					{props.phonesHere && address ? (
						<Button onClick={() => onOpenChange(false)}>Done</Button>
					) : (
						<SettingsButton>Turn on Be a Host</SettingsButton>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
