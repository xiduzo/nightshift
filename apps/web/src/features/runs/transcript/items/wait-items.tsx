/** The items of a wait: what the step waits for, and when it wakes. */
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import { MoonIcon, SunriseIcon } from "lucide-react";
import { formatDateTime, formatRelative, formatTime } from "@/shared/format";
import type { WaitItem, WakeItem } from "../transcript-items";

const WAIT_TITLE: Record<WaitItem["reason"], string> = {
	"usage-limit": "Usage limit reached",
	network: "The network is down",
	duration: "Waiting",
	time: "Waiting for a time",
	command: "Waiting for a command to pass",
	signal: "Waiting for a signal",
	"device-offline": "Waiting for a device",
};

/** A Wait node's own wait, or the run policy's (a usage limit, the network). */
const isNodeWait = (reason: WaitItem["reason"]) =>
	reason !== "usage-limit" &&
	reason !== "network" &&
	reason !== "device-offline";

/**
 * The run sleeps on this step: the run policy continues the same session
 * at a time; a Wait node goes on at its time, when its command passes, or
 * when its signal comes.
 */
export function WaitCard({ item }: { item: WaitItem }) {
	const { until } = item;
	const at =
		until === null ? null : (
			<>
				<time
					dateTime={new Date(until).toISOString()}
					title={formatDateTime(until)}
					className="text-foreground tabular-nums"
				>
					{formatTime(until)}
				</time>{" "}
				({formatRelative(until)})
			</>
		);
	const next =
		item.reason === "signal" ? (
			<>
				Continues when the signal{" "}
				<span className="font-mono text-foreground">{item.signal}</span> arrives
				{at ? <>, or times out at {at}</> : null}.
			</>
		) : item.reason === "command" ? (
			<>Tries the command again{at ? <> at {at}</> : null}.</>
		) : item.reason === "device-offline" ? (
			<>
				Checks for the device again
				{at ? <> at {at}</> : null}.
			</>
		) : isNodeWait(item.reason) ? (
			<>Continues{at ? <> at {at}</> : null}.</>
		) : (
			<>Continues where it stopped{at ? <> at {at}</> : null}.</>
		);
	return (
		<Alert
			role="status"
			className="border-status-sleeping/40 bg-status-sleeping/10"
		>
			<MoonIcon aria-hidden="true" className="text-status-sleeping!" />
			<AlertTitle className="text-status-sleeping">
				{WAIT_TITLE[item.reason]} · sleeping
			</AlertTitle>
			<AlertDescription className="flex flex-col gap-1">
				{item.message ? (
					<p className="whitespace-pre-wrap break-words text-foreground">
						{item.message}
					</p>
				) : null}
				<p>{next}</p>
			</AlertDescription>
		</Alert>
	);
}

export function WakeMarker({ item }: { item: WakeItem }) {
	return (
		<Marker className="text-xs">
			<MarkerIcon>
				<SunriseIcon className="size-3.5 text-status-sleeping" />
			</MarkerIcon>
			<MarkerContent>
				{item.signal !== undefined ? (
					<>
						Signal <span className="font-mono">{item.signal}</span> received
					</>
				) : (
					"Woke"
				)}{" "}
				· {formatTime(item.at)}
			</MarkerContent>
		</Marker>
	);
}
