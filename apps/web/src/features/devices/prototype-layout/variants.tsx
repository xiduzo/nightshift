/**
 * PROTOTYPE, throw away. Three other shapes of the Devices page, switched
 * with `?variant=` on `/devices`. A is the page as it is today: a list card
 * on the right, the detail on the left.
 *
 * - B Setup page: one column like Agents and Settings. A section per kind
 *   (Host, your computers, your phones, members' computers) of outline
 *   rows. A pick opens its detail in place; the breadcrumb leads back.
 * - C Host hub: the Host as a card on top, the computers as cards under
 *   it, each with what runs on it now. A pick opens in a sheet. C1, C2 and
 *   C3 add a way to the next step (`hub.tsx`), and `?state=` forces a state
 *   of the page (`states.ts`).
 * - D Table: every device in one table with a filter. A pick opens its
 *   detail in place; the breadcrumb leads back.
 *
 * Every variant gets the same data from `DevicesPage`, and the same detail
 * components (Host, computer, phone).
 */
import { platformName } from "@nightshift/client";
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
import { useNavigate } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	type LucideIcon,
	SmartphoneIcon,
	UsersIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Phone } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";
import { computerIcon } from "../computer-detail";
import type { SpaceComputer, SpaceHost } from "../space-view";
import { ComputerStatus, computerLine } from "../status-badges";
import { DevicesHub } from "./hub";
import {
	crumbs,
	DeviceLink,
	Frame,
	hostInfo,
	PairButton,
	PHONE,
	type Props,
	phonesEmpty,
	RunningBadge,
	running,
} from "./parts";

export const DEVICES_VARIANTS = [
	{ key: "A", name: "Today: list on the right" },
	{ key: "B", name: "Setup page, detail in place" },
	{ key: "C", name: "Host hub, cards and a sheet" },
	{ key: "C1", name: "Hub + setup checklist" },
	{ key: "C2", name: "Hub + open slots" },
	{ key: "C3", name: "Hub + next step" },
	{ key: "D", name: "One table with a filter" },
] as const;

export function DevicesVariant(props: Props) {
	switch (props.variant) {
		case "C":
		case "C1":
		case "C2":
		case "C3":
			return <DevicesHub {...props} />;
		case "D":
			return <TableVariant {...props} />;
		default:
			return <SetupVariant {...props} />;
	}
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
