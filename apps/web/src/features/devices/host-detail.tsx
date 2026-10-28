import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Link } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	HouseIcon,
	LinkIcon,
	PlusIcon,
	ServerIcon,
	SettingsIcon,
} from "lucide-react";
import { DetailSection, DetailShell } from "@/shared/detail";
import { formatRelative, useNow } from "@/shared/format";
import { OnlineDot } from "./devices-list";
import { LeaveHostButton } from "./leave-host";
import type { SpaceHost } from "./space-view";
import { HostStatus } from "./status-badges";

/**
 * The Host that keeps the Space: what it does for the Space, and how this
 * computer reaches it. Every Space has one.
 */
export function HostDetail({
	host,
	space,
	onPair,
}: {
	host: SpaceHost;
	space: { name: string; personal: boolean };
	/** Opens "Pair a device", where this computer is the Host and pairing is on. */
	onPair?: () => void;
}) {
	return host.kind === "linked" ? (
		<LinkedHostDetail host={host.host} space={space} />
	) : (
		<ThisComputerHostDetail
			computer={host.computer}
			space={space}
			onPair={onPair}
		/>
	);
}

function LinkedHostDetail({
	host,
	space,
}: {
	host: Extract<SpaceHost, { kind: "linked" }>["host"];
	space: { name: string };
}) {
	const now = useNow(30_000);
	const home = host.role === "home";
	return (
		<DetailShell
			icon={home ? <HouseIcon /> : <LinkIcon />}
			kicker={`Host of ${space.name}`}
			title={host.name}
			subtitle={
				<span className="flex flex-wrap items-center gap-2">
					<HostStatus status={host.status} />
					{host.status === "online"
						? "Connected now."
						: host.status === "connecting"
							? "Connecting."
							: host.status === "revoked"
								? "It removed the access of this computer."
								: `Not connected since ${formatRelative(host.since, now)}.`}
				</span>
			}
		>
			{host.status === "revoked" ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>This computer cannot sync with {host.name}</AlertTitle>
					<AlertDescription>
						Its owner removed the access of this computer. Join the Host again
						in Settings to sync.
					</AlertDescription>
				</Alert>
			) : null}
			<DetailSection
				title="What it does"
				description="Every Space has one Host."
			>
				<p className="text-sm">
					It keeps the projects, runs and members of {space.name}. Runs start
					there, unless a step names another computer.{" "}
					{home
						? "It is your home Host: it also keeps the settings of this computer."
						: "It is a guest Host: it gets nothing of this computer but the Spaces it keeps."}
				</p>
			</DetailSection>
			<DetailSection
				title="Connection"
				description="The addresses this computer tries, in this order."
			>
				<div className="flex flex-col gap-1.5 text-sm">
					{host.addresses.map((address) => (
						<div key={address} className="flex items-center gap-2">
							<OnlineDot online={address === host.address ? true : null} />
							<code className="truncate text-xs">{address}</code>
							{address === host.address ? (
								<span className="text-muted-foreground text-xs">
									answers now
								</span>
							) : null}
						</div>
					))}
					{host.fingerprint ? (
						<p className="mt-2 break-all text-muted-foreground text-xs">
							Certificate fingerprint{" "}
							<span className="font-mono">{host.fingerprint}</span>
						</p>
					) : null}
				</div>
			</DetailSection>
			<DetailSection
				title="Spaces it keeps"
				description="The Spaces this computer takes part in through this Host."
			>
				<div className="flex flex-wrap gap-1.5">
					{host.spaces.map((s) => (
						<Badge key={s.id} variant="outline">
							{s.name}
						</Badge>
					))}
				</div>
			</DetailSection>
			{home && host.status !== "revoked" ? (
				<DetailSection
					title="Leave"
					description={`${host.name} keeps everything. This computer keeps its own Personal.`}
				>
					<LeaveHostButton hostName={host.name} />
				</DetailSection>
			) : null}
		</DetailShell>
	);
}

function ThisComputerHostDetail({
	computer,
	space,
	onPair,
}: {
	computer: Extract<SpaceHost, { kind: "this-computer" }>["computer"];
	space: { name: string; personal: boolean };
	onPair?: () => void;
}) {
	return (
		<DetailShell
			icon={<ServerIcon />}
			kicker={`Host of ${space.name}`}
			title={computer?.name ?? "This Host"}
			subtitle="This computer"
		>
			<DetailSection
				title="What it does"
				description="Every Space has one Host."
			>
				<p className="text-sm">
					This computer keeps the projects, runs and members of {space.name}.
					Runs start here, unless a step names another computer.{" "}
					{computer
						? computer.host.enabled
							? "Your other computers can pair with it and sync through it."
							: "Only this computer works in it now. Turn on Be a Host in Settings to let your other computers pair with it."
						: null}
				</p>
				{onPair ? (
					<Button size="sm" className="mt-3" onClick={onPair}>
						<PlusIcon data-icon="inline-start" />
						Pair a device
					</Button>
				) : null}
			</DetailSection>
			{computer ? (
				<DetailSection
					title="Settings of this computer"
					description="Be a Host, its addresses, and the Hosts it joined."
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
			) : null}
		</DetailShell>
	);
}
