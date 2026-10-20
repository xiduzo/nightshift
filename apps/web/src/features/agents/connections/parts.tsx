import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import { Avatar, AvatarFallback } from "@nightshift/ui/components/avatar";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	KeyRoundIcon,
	type LucideIcon,
	SendIcon,
	TerminalIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { SecretSource } from "@/shared/api";

/** The 40px tile with initials that heads each connection card. */
export function MonoTile({ children }: { children: string }) {
	return (
		<Avatar size="lg" className="rounded-lg after:rounded-lg" aria-hidden>
			<AvatarFallback className="rounded-lg font-medium font-mono text-foreground text-xs">
				{children}
			</AvatarFallback>
		</Avatar>
	);
}

/** Two letters for a connection name: `issue_tracker` → IT, `echo` → EC. */
export function initials(name: string): string {
	const parts = name.split(/[_\-\s]+/).filter(Boolean);
	const letters =
		parts.length > 1
			? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
			: name.slice(0, 2);
	return letters.toUpperCase();
}

export type Fact = { label: string; value: ReactNode };

/** A label → value list: Path, Version, Account and the like. */
export function FactList({ facts }: { facts: Fact[] }) {
	return (
		<dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
			{facts.map((fact) => (
				<div key={fact.label} className="contents">
					<dt className="text-muted-foreground">{fact.label}</dt>
					<dd className="min-w-0 break-words">{fact.value}</dd>
				</div>
			))}
		</dl>
	);
}

/** What leaves this machine when Night Shift uses the connection. */
export function OffMachineNote({ children }: { children: ReactNode }) {
	return (
		<Alert className="border-border bg-muted/40 px-3 py-2.5">
			<SendIcon className="text-status-waiting" aria-hidden />
			<AlertDescription className="text-foreground/80">
				<span className="sr-only">Leaves this machine: </span>
				{children}
			</AlertDescription>
		</Alert>
	);
}

export type CheckState = "ready" | "problem" | "missing" | "checking";

const CHECK_STATE: Record<
	Exclude<CheckState, "checking">,
	{ label: string; icon: LucideIcon; className: string }
> = {
	ready: {
		label: "Ready",
		icon: CircleCheckIcon,
		className:
			"border-status-finished/40 bg-status-finished/10 text-status-finished",
	},
	problem: {
		label: "Problem",
		icon: CircleAlertIcon,
		className: "border-status-failed/40 bg-status-failed/10 text-status-failed",
	},
	missing: {
		label: "Not found",
		icon: CircleDashedIcon,
		className:
			"border-status-waiting/40 bg-status-waiting/10 text-status-waiting",
	},
};

/** Ready, Problem or Not found, for a CLI check. */
export function CheckBadge({ state }: { state: CheckState }) {
	if (state === "checking") {
		return (
			<Badge variant="outline" className="text-muted-foreground">
				Checking
			</Badge>
		);
	}
	const { label, icon: Icon, className } = CHECK_STATE[state];
	return (
		<Badge variant="outline" className={className}>
			<Icon data-icon="inline-start" aria-hidden />
			{label}
		</Badge>
	);
}

/** Local command or Remote URL. */
export function KindBadge({ kind }: { kind: "command" | "url" }) {
	return (
		<Badge variant="secondary">
			{kind === "command" ? (
				<TerminalIcon data-icon="inline-start" aria-hidden />
			) : (
				<SendIcon data-icon="inline-start" aria-hidden />
			)}
			{kind === "command" ? "Local command" : "Remote URL"}
		</Badge>
	);
}

const SOURCE_LABEL: Record<SecretSource, string> = {
	keychain: "Keychain",
	env: "Outside Night Shift",
	missing: "Missing",
};

/** A `${NAME}` reference and where its value comes from. */
export function VariableBadge({
	name,
	source,
}: {
	name: string;
	source: SecretSource;
}) {
	const badge = (
		<Badge
			variant={source === "env" ? "secondary" : "outline"}
			className={cn(
				"max-w-full",
				source === "keychain" &&
					"border-status-finished/40 bg-status-finished/10 text-status-finished",
				source === "missing" &&
					"border-status-waiting/40 bg-status-waiting/10 text-status-waiting",
			)}
		>
			<KeyRoundIcon data-icon="inline-start" aria-hidden />
			<span className="truncate font-mono">{name}</span>
			<span className="font-normal opacity-80">· {SOURCE_LABEL[source]}</span>
		</Badge>
	);
	if (source !== "missing") return badge;
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="inline-flex max-w-full" />}>
				{badge}
			</TooltipTrigger>
			<TooltipContent className="max-w-64">
				No value yet. Save one under Secrets below.
			</TooltipContent>
		</Tooltip>
	);
}
