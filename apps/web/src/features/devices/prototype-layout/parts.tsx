/** PROTOTYPE, throw away: what the Devices page variants share. */
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	HouseIcon,
	LinkIcon,
	type LucideIcon,
	PlusIcon,
	ServerIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Phone, RunSummary } from "@/shared/api";
import type { Crumb } from "@/shared/page";
import type { SpaceHost, SpaceView } from "../space-view";
import { HostStatus } from "../status-badges";

export type Props = {
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
	/** This computer's Be a Host. Null for another Person's computer. */
	beAHost: boolean | null;
	/** This computer has a home Host already. */
	hasHome: boolean;
	onRetry: () => void;
};

// ─── Shared bits ─────────────────────────────────────────────────────────

export const PHONE = "phone:";

export function DeviceLink({ device }: { device: string }) {
	return (
		<Link
			to="/devices"
			search={(prev: Record<string, unknown>) => ({ ...prev, device })}
		/>
	);
}

export function crumbs(props: Props): Crumb[] {
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

export function hostInfo(host: SpaceHost): {
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

export function running(runs: RunSummary[] | undefined): number {
	return (runs ?? []).filter((r) => r.status === "running").length;
}

export function RunningBadge({ count }: { count: number }) {
	return count > 0 ? (
		<Badge variant="outline" className="tabular-nums">
			{count} running
		</Badge>
	) : null;
}

export function PairButton({ onClick }: { onClick: () => void }) {
	return (
		<Button variant="outline" size="sm" onClick={onClick}>
			<PlusIcon data-icon="inline-start" />
			Pair a device
		</Button>
	);
}

export function phonesEmpty(props: Props): string {
	return props.phonesPending
		? "Loading."
		: props.phonesHere
			? `Sign in to ${props.hostName} in the Night Shift app on your phone, and turn on its notifications.`
			: "A phone signs in to a Host. Turn on Be a Host in Settings, or open a Space of a Host you joined.";
}

/** Loading, an error, or the page. */
export function Frame({
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
