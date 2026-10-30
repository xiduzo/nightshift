/**
 * PROTOTYPE, throw away. Three other shapes of the Devices page, switched
 * with `?variant=` on `/devices`. A is the page as it is today: a list card
 * on the right, the detail on the left.
 *
 * - B Setup page: one column like Agents and Settings. A section per kind
 *   (Host, your computers, your phones, members' computers) of outline
 *   rows. A pick opens its detail in place; the breadcrumb leads back.
 * - C Host hub: the Host as a card on top, the computers as cards under
 *   it, each with what runs on it now. A pick opens in a sheet.
 * - D Table: every device in one table with a filter. A pick opens its
 *   detail in place; the breadcrumb leads back.
 *
 * Every variant gets the same data from `DevicesPage`, and the same detail
 * components (Host, computer, phone).
 */
import { platformName } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
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
	Empty,
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
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	HouseIcon,
	LinkIcon,
	type LucideIcon,
	PlusIcon,
	ServerIcon,
	SmartphoneIcon,
	UsersIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Phone, RunSummary } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import {
	type Crumb,
	PageHeading,
	PageSection,
	SiteHeader,
} from "@/shared/page";
import { computerIcon } from "../computer-detail";
import type { SpaceComputer, SpaceHost, SpaceView } from "../space-view";
import { ComputerStatus, computerLine, HostStatus } from "../status-badges";

export const DEVICES_VARIANTS = [
	{ key: "A", name: "Today: list on the right" },
	{ key: "B", name: "Setup page, detail in place" },
	{ key: "C", name: "Host hub, cards and a sheet" },
	{ key: "D", name: "One table with a filter" },
] as const;

type Props = {
	variant: string;
	loading: boolean;
	error: Error | null;
	space: { id: string; name: string; personal: boolean } | undefined;
	view: SpaceView | null;
	phones: Phone[];
	phonesPending: boolean;
	/** A phone can sign in to the Host of this Space. */
	phonesHere: boolean;
	hostName: string;
	runsOn: Map<string, RunSummary[]>;
	now: number;
	canPair: boolean;
	onPair: () => void;
	/** The detail of what is picked, or null for the overview. */
	detail: ReactNode;
	detailLabel: string;
	selected: string | undefined;
	elsewhere: ReactNode;
};

export function DevicesVariant(props: Props) {
	switch (props.variant) {
		case "C":
			return <HubVariant {...props} />;
		case "D":
			return <TableVariant {...props} />;
		default:
			return <SetupVariant {...props} />;
	}
}

// ─── Shared bits ─────────────────────────────────────────────────────────

const PHONE = "phone:";

function DeviceLink({ device }: { device: string }) {
	return (
		<Link
			to="/devices"
			search={(prev: Record<string, unknown>) => ({ ...prev, device })}
		/>
	);
}

function crumbs(props: Props): Crumb[] {
	return props.detail
		? [
				{
					label: "Devices",
					link: { to: "/devices", search: { variant: props.variant } },
				},
				{ label: props.detailLabel },
			]
		: [{ label: "Devices" }];
}

function hostInfo(host: SpaceHost): {
	name: string;
	role: string;
	Icon: LucideIcon;
	status: ReactNode;
	line: string;
} {
	if (host.kind === "linked") {
		const h = host.host;
		return {
			name: h.name,
			role: h.role === "home" ? "Your home Host" : "A guest Host",
			Icon: h.role === "home" ? HouseIcon : LinkIcon,
			status: <HostStatus status={h.status} />,
			line: h.address ?? h.addresses[0] ?? "No address yet",
		};
	}
	return {
		name: host.computer?.name ?? "This Host",
		role: "This computer",
		Icon: ServerIcon,
		status: (
			<Badge
				variant="outline"
				className="border-status-finished/40 bg-status-finished/10 text-status-finished"
			>
				Online
			</Badge>
		),
		line: host.computer?.host.enabled
			? "Your other computers can pair with it."
			: "Only this computer works in it.",
	};
}

function running(runs: RunSummary[] | undefined): number {
	return (runs ?? []).filter((r) => r.status === "running").length;
}

function RunningBadge({ count }: { count: number }) {
	return count > 0 ? (
		<Badge variant="outline" className="tabular-nums">
			{count} running
		</Badge>
	) : null;
}

function PairButton({ onClick }: { onClick: () => void }) {
	return (
		<Button variant="outline" size="sm" onClick={onClick}>
			<PlusIcon data-icon="inline-start" />
			Pair a device
		</Button>
	);
}

function phonesEmpty(props: Props): string {
	return props.phonesPending
		? "Loading."
		: props.phonesHere
			? `Sign in to ${props.hostName} in the Night Shift app on your phone, and turn on its notifications.`
			: "A phone signs in to a Host. Turn on Be a Host in Settings, or open a Space of a Host you joined.";
}

/** Loading, an error, or the page. */
function Frame({
	props,
	width = "max-w-4xl",
	children,
}: {
	props: Props;
	width?: string;
	children: ReactNode;
}) {
	return (
		<div className={`mx-auto flex w-full ${width} flex-col gap-8 p-4 md:p-6`}>
			{props.error ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>The devices did not load</AlertTitle>
					<AlertDescription>{props.error.message}</AlertDescription>
				</Alert>
			) : props.loading || !props.view || !props.space ? (
				<div className="flex flex-col gap-6" aria-hidden>
					<Skeleton className="h-12 w-72" />
					<Skeleton className="h-40 w-full" />
					<Skeleton className="h-40 w-full" />
				</div>
			) : (
				<>
					{props.elsewhere}
					{children}
				</>
			)}
		</div>
	);
}

// ─── B: Setup page ───────────────────────────────────────────────────────

function SetupVariant(props: Props) {
	const { view, space } = props;
	return (
		<>
			<SiteHeader crumbs={crumbs(props)} />
			{props.detail ? (
				props.detail
			) : (
				<Frame props={props}>
					{view && space ? (
						<>
							<PageHeading
								title="Devices"
								description={
									space.personal
										? "Your computers and phones. Steps of your flows run on the computers."
										: `The computers and phones in ${space.name}. Steps run on the computers.`
								}
							/>
							<div className="flex flex-col gap-10">
								<PageSection
									title="Host"
									description={`It keeps the projects, runs and members of ${space.name}.`}
								>
									<ItemGroup className="gap-2">
										<HostRow host={view.host} />
									</ItemGroup>
								</PageSection>

								<PageSection
									title="Your computers"
									description="Night Shift runs steps on them."
									actions={
										props.canPair ? (
											<PairButton onClick={props.onPair} />
										) : undefined
									}
								>
									<ItemGroup className="gap-2">
										{view.yours.map((c) => (
											<ComputerRow
												key={c.id}
												computer={c}
												now={props.now}
												running={running(props.runsOn.get(c.id))}
											/>
										))}
									</ItemGroup>
								</PageSection>

								<PageSection
									title="Your phones"
									description="They show runs and Gates, and tell you when a Gate waits."
								>
									{props.phones.length === 0 ? (
										<Empty className="border">
											<EmptyHeader>
												<EmptyMedia variant="icon">
													<SmartphoneIcon />
												</EmptyMedia>
												<EmptyTitle>No phones yet</EmptyTitle>
												<EmptyDescription>
													{phonesEmpty(props)}
												</EmptyDescription>
											</EmptyHeader>
										</Empty>
									) : (
										<ItemGroup className="gap-2">
											{props.phones.map((phone) => (
												<PhoneRow
													key={phone.id}
													phone={phone}
													now={props.now}
												/>
											))}
										</ItemGroup>
									)}
								</PageSection>

								{space.personal ? null : (
									<PageSection
										title="Members' computers"
										description="You see what runs on them and what they offer to this Space."
									>
										{view.members.length === 0 ? (
											<p className="text-muted-foreground text-sm">
												A member's computer shows here once it has a copy of a
												project of this Space, or offers a profile to it.
											</p>
										) : (
											<ItemGroup className="gap-2">
												{view.members.map((c) => (
													<ComputerRow
														key={c.id}
														computer={c}
														now={props.now}
														running={running(props.runsOn.get(c.id))}
													/>
												))}
											</ItemGroup>
										)}
									</PageSection>
								)}
							</div>
						</>
					) : null}
				</Frame>
			)}
		</>
	);
}

function OpenRow({
	device,
	Icon,
	title,
	description,
	aside,
}: {
	device: string;
	Icon: LucideIcon;
	title: ReactNode;
	description?: ReactNode;
	aside?: ReactNode;
}) {
	return (
		<Item variant="outline" size="sm" render={<DeviceLink device={device} />}>
			<ItemMedia variant="icon">
				<Icon />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>{title}</ItemTitle>
				{description ? (
					<ItemDescription className="truncate">{description}</ItemDescription>
				) : null}
			</ItemContent>
			<ItemActions>
				{aside}
				<ChevronRightIcon className="size-4 text-muted-foreground" />
			</ItemActions>
		</Item>
	);
}

function HostRow({ host }: { host: SpaceHost }) {
	const info = hostInfo(host);
	return (
		<OpenRow
			device="host"
			Icon={info.Icon}
			title={info.name}
			description={`${info.role} · ${info.line}`}
			aside={info.status}
		/>
	);
}

function ComputerRow({
	computer,
	now,
	running,
}: {
	computer: SpaceComputer;
	now: number;
	running: number;
}) {
	return (
		<OpenRow
			device={computer.id}
			Icon={computerIcon(computer.platform)}
			title={
				<>
					{computer.name}
					{computer.thisDevice ? (
						<span className="font-normal text-muted-foreground">
							this computer
						</span>
					) : null}
				</>
			}
			description={[
				computer.mine ? null : computer.owner,
				computer.platform ? platformName(computer.platform) : null,
				computerLine(computer, now).replace(/\.$/, ""),
			]
				.filter(Boolean)
				.join(" · ")}
			aside={
				<>
					<RunningBadge count={running} />
					<ComputerStatus computer={computer} />
				</>
			}
		/>
	);
}

function PhoneRow({ phone, now }: { phone: Phone; now: number }) {
	return (
		<OpenRow
			device={`${PHONE}${phone.id}`}
			Icon={SmartphoneIcon}
			title={phone.name}
			description={[
				platformName(phone.platform),
				phone.lastSeenAt
					? `Seen ${formatRelative(phone.lastSeenAt, now)}`
					: null,
			]
				.filter(Boolean)
				.join(" · ")}
		/>
	);
}

// ─── C: Host hub ─────────────────────────────────────────────────────────

function HubVariant(props: Props) {
	const { view, space } = props;
	const navigate = useNavigate();
	return (
		<>
			<SiteHeader crumbs={[{ label: "Devices" }]} />
			<Frame props={props} width="max-w-6xl">
				{view && space ? (
					<>
						<PageHeading
							title={space.name}
							description="Its Host keeps everything. Your computers and the members' computers run the steps."
							actions={
								props.canPair ? <PairButton onClick={props.onPair} /> : null
							}
						/>
						<HostCard {...props} host={view.host} />
						<div className="flex flex-col gap-4">
							<h2 className="font-semibold text-lg tracking-tight">
								{space.personal ? "Your computers" : "Computers in this Space"}
							</h2>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{[...view.yours, ...view.members].map((c) => (
									<ComputerCard
										key={c.id}
										computer={c}
										runs={props.runsOn.get(c.id) ?? []}
										now={props.now}
									/>
								))}
							</div>
							{!space.personal && view.members.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									A member's computer shows here once it has a copy of a project
									of this Space, or offers a profile to it.
								</p>
							) : null}
						</div>
					</>
				) : null}
			</Frame>
			<Sheet
				open={props.detail !== null}
				onOpenChange={(open) => {
					if (!open)
						void navigate({
							to: "/devices",
							search: { variant: props.variant },
						});
				}}
			>
				<SheetContent className="p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
					<SheetTitle className="sr-only">{props.detailLabel}</SheetTitle>
					<ScrollArea className="h-full">{props.detail}</ScrollArea>
				</SheetContent>
			</Sheet>
		</>
	);
}

function HostCard(props: Props & { host: SpaceHost }) {
	const info = hostInfo(props.host);
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-3">
					<div className="flex size-10 items-center justify-center rounded-lg bg-muted [&_svg]:size-5">
						<info.Icon />
					</div>
					<div className="flex flex-col gap-0.5">
						<CardTitle className="flex items-center gap-2">
							{info.name}
							{info.status}
						</CardTitle>
						<CardDescription>
							Host · {info.role} · <code className="text-xs">{info.line}</code>
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
			<CardContent className="flex flex-col gap-2">
				<p className="text-muted-foreground text-xs">Your phones on it</p>
				{props.phones.length === 0 ? (
					<p className="text-muted-foreground text-sm">{phonesEmpty(props)}</p>
				) : (
					<div className="flex flex-wrap gap-2">
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
							</Button>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function ComputerCard({
	computer,
	runs,
	now,
}: {
	computer: SpaceComputer;
	runs: RunSummary[];
	now: number;
}) {
	const Icon = computerIcon(computer.platform);
	return (
		<Card size="sm" className="transition-colors hover:bg-muted/40">
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
						{computerLine(computer, now)}
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
			</CardFooter>
		</Card>
	);
}

// ─── D: Table ────────────────────────────────────────────────────────────

type Filter = "all" | "yours" | "members" | "phones";

type Row = {
	device: string;
	Icon: LucideIcon;
	name: ReactNode;
	kind: string;
	owner: string;
	status: ReactNode;
	running: number;
	projects: number | null;
	seen: string;
	group: Exclude<Filter, "all"> | "host";
};

function TableVariant(props: Props) {
	const { view, space } = props;
	const [filter, setFilter] = useState<Filter>("all");
	const navigate = useNavigate();
	if (props.detail)
		return (
			<>
				<SiteHeader crumbs={crumbs(props)} />
				{props.detail}
			</>
		);

	const rows: Row[] = [];
	if (view) {
		const info = hostInfo(view.host);
		rows.push({
			device: "host",
			Icon: info.Icon,
			name: info.name,
			kind: "Host",
			owner: info.role,
			status: info.status,
			running: 0,
			projects: null,
			seen: "",
			group: "host",
		});
		for (const c of [...view.yours, ...view.members]) {
			rows.push({
				device: c.id,
				Icon: computerIcon(c.platform),
				name: (
					<>
						{c.name}
						{c.thisDevice ? (
							<span className="ml-2 text-muted-foreground">this computer</span>
						) : null}
					</>
				),
				kind: c.platform ? platformName(c.platform) : "Computer",
				owner: c.mine ? "You" : (c.owner ?? "A member"),
				status: <ComputerStatus computer={c} />,
				running: running(props.runsOn.get(c.id)),
				projects: c.clones.length,
				seen: c.thisDevice
					? "Now"
					: c.lastSeenAt
						? formatRelative(c.lastSeenAt, props.now)
						: "",
				group: c.mine ? "yours" : "members",
			});
		}
		for (const phone of props.phones) {
			rows.push({
				device: `${PHONE}${phone.id}`,
				Icon: SmartphoneIcon,
				name: phone.name,
				kind: `Phone · ${platformName(phone.platform)}`,
				owner: "You",
				status: null,
				running: 0,
				projects: null,
				seen: phone.lastSeenAt
					? formatRelative(phone.lastSeenAt, props.now)
					: "",
				group: "phones",
			});
		}
	}
	const shown = rows.filter(
		(r) => filter === "all" || r.group === "host" || r.group === filter,
	);

	return (
		<>
			<SiteHeader crumbs={crumbs(props)} />
			<Frame props={props} width="max-w-6xl">
				{view && space ? (
					<>
						<PageHeading
							title="Devices"
							description={`Every computer and phone in ${space.name}. Pick one to see what runs on it.`}
							actions={
								props.canPair ? <PairButton onClick={props.onPair} /> : null
							}
						/>
						<ToggleGroup
							variant="outline"
							size="sm"
							spacing={0}
							value={[filter]}
							onValueChange={(next: string[]) => {
								if (next[0]) setFilter(next[0] as Filter);
							}}
						>
							<ToggleGroupItem value="all">All</ToggleGroupItem>
							<ToggleGroupItem value="yours">Your computers</ToggleGroupItem>
							{space.personal ? null : (
								<ToggleGroupItem value="members">
									<UsersIcon />
									Members
								</ToggleGroupItem>
							)}
							<ToggleGroupItem value="phones">Phones</ToggleGroupItem>
						</ToggleGroup>
						<div className="overflow-hidden rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Device</TableHead>
										<TableHead>Kind</TableHead>
										<TableHead>Owner</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Running</TableHead>
										<TableHead className="text-right">Projects</TableHead>
										<TableHead className="text-right">Last seen</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{shown.map((row) => (
										<TableRow
											key={row.device}
											className="cursor-pointer"
											onClick={() =>
												void navigate({
													to: "/devices",
													search: {
														variant: props.variant,
														device: row.device,
													},
												})
											}
										>
											<TableCell className="font-medium">
												<span className="flex items-center gap-2">
													<row.Icon className="size-4 text-muted-foreground" />
													{row.name}
												</span>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{row.kind}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{row.owner}
											</TableCell>
											<TableCell>{row.status}</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.running || ""}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.projects ?? ""}
											</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{row.seen}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</>
				) : null}
			</Frame>
		</>
	);
}
