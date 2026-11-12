import {
	type FlowLevel,
	type FlowSignal,
	flowLevelHint,
	flowLevelLabel,
	signalScale,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleSlashIcon,
	CircleXIcon,
	EyeIcon,
	MoonStarIcon,
	UserRoundIcon,
	WavesIcon,
} from "lucide-react";

/** The pieces that show the watch over a flow: its level, its weeks, a signal. */

const LEVEL_ICON = { decide: UserRoundIcon, check: EyeIcon, own: MoonStarIcon };

const LEVEL_TEXT: Record<FlowLevel, string> = {
	decide: "text-status-waiting",
	check: "text-status-running",
	own: "text-status-finished",
};

/** The level of a flow, with what it says about the last runs on hover. */
export function LevelBadge({ level }: { level: FlowLevel }) {
	const Icon = LEVEL_ICON[level];
	return (
		<Tooltip>
			<TooltipTrigger render={<Badge variant="outline" className="shrink-0" />}>
				<Icon className={LEVEL_TEXT[level]} aria-hidden="true" />
				{flowLevelLabel(level)}
			</TooltipTrigger>
			<TooltipContent>{flowLevelHint(level)}</TooltipContent>
		</Tooltip>
	);
}

/** One small bar per week, oldest first. The last one is the week until now. */
export function WeekBars({
	weeks,
	className,
}: {
	weeks: readonly number[];
	className?: string;
}) {
	const max = Math.max(1, ...weeks);
	return (
		<span
			className={cn("flex h-6 w-20 items-end gap-px", className)}
			aria-hidden="true"
		>
			{weeks.map((count, week) => (
				<span
					key={week}
					className={cn(
						"min-h-px flex-1 rounded-[1px]",
						week === weeks.length - 1
							? "bg-foreground/70"
							: "bg-muted-foreground/30",
					)}
					style={{ height: `${(count / max) * 100}%` }}
				/>
			))}
		</span>
	);
}

const SIGNAL_ICON: Record<FlowSignal["kind"], typeof WavesIcon> = {
	failing: CircleXIcon,
	nothing: CircleSlashIcon,
	cost: WavesIcon,
	length: WavesIcon,
	slow: WavesIcon,
};

export function SignalIcon({ signal }: { signal: FlowSignal }) {
	const Icon = SIGNAL_ICON[signal.kind];
	return (
		<Icon
			className={cn(
				"size-4 shrink-0",
				signal.severe || signal.kind === "failing"
					? "text-status-failed"
					: "text-status-waiting",
			)}
			aria-hidden="true"
		/>
	);
}

/** Where the value now sits against the usual range. Nothing for a signal without numbers. */
export function UsualRange({ signal }: { signal: FlowSignal }) {
	const scale = signalScale(signal);
	if (!scale) return null;
	return (
		<div
			className="relative h-2 w-full rounded-full bg-muted"
			aria-hidden="true"
		>
			<span
				className="absolute inset-y-0 min-w-1 rounded-full bg-status-finished/50"
				style={{ left: `${scale.low}%`, width: `${scale.high - scale.low}%` }}
			/>
			<span
				className="absolute top-1/2 size-3 -translate-x-full -translate-y-1/2 rounded-full border-2 border-background bg-status-failed"
				style={{ left: `${scale.now}%` }}
			/>
		</div>
	);
}
