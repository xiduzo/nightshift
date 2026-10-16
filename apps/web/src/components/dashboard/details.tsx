import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { ChevronRightIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, useId } from "react";

import type { Project } from "@/lib/api-types";

/**
 * The details dialog behind a stat card, after the details dialog of a Home
 * Assistant sensor. The body mounts only while open, so its hooks and
 * derived data cost nothing on the dashboard.
 */
export function DetailsDialog({
	open,
	onOpenChange,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
				{open ? children : null}
			</DialogContent>
		</Dialog>
	);
}

/** "nightshift › Runs" over the title. */
export function DetailsHeader({
	project,
	trail,
	title,
}: {
	project?: Project;
	trail: string;
	title: string;
}) {
	return (
		<DialogHeader>
			<DialogDescription className="flex items-center gap-1 text-xs">
				{project ? project.name : "All projects"}
				<ChevronRightIcon className="size-3" aria-hidden="true" />
				{trail}
			</DialogDescription>
			<DialogTitle>{title}</DialogTitle>
		</DialogHeader>
	);
}

export function Stat({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<Card size="sm" className="gap-1">
			<CardHeader>
				<CardDescription className="text-xs">{label}</CardDescription>
				<CardTitle className="text-lg tabular-nums">{value}</CardTitle>
				{hint ? (
					<CardDescription className="text-xs">{hint}</CardDescription>
				) : null}
			</CardHeader>
		</Card>
	);
}

/** A chart with its heading, a hint under it and an optional range toggle. */
export function ChartSection({
	title,
	hint,
	toggle,
	children,
}: {
	title: string;
	hint: string;
	toggle?: ReactNode;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="flex flex-col gap-3">
			<div className="flex flex-wrap items-end justify-between gap-2">
				<div className="flex flex-col gap-0.5">
					<h3 id={id} className="font-medium text-base">
						{title}
					</h3>
					<p className="text-muted-foreground text-xs">{hint}</p>
				</div>
				{toggle}
			</div>
			{children}
		</section>
	);
}

/** Where a chart or a list would be, when it has nothing to show. */
export function DetailsEmpty({ children }: { children: ReactNode }) {
	return (
		<p className="rounded-md border border-dashed px-4 py-10 text-center text-muted-foreground text-sm">
			{children}
		</p>
	);
}

/** One of a few ranges, as a toggle group: "7n 30n 90n" or "24h 48h 7d". */
export function RangeToggle<Range extends number>({
	ranges,
	value,
	onValueChange,
	short,
	long,
}: {
	ranges: readonly Range[];
	value: Range;
	onValueChange: (range: Range) => void;
	/** The button text, "30n". */
	short: (range: Range) => string;
	/** What a screen reader hears, "Last 30 nights". */
	long: (range: Range) => string;
}) {
	return (
		<ToggleGroup
			variant="outline"
			size="sm"
			spacing={0}
			aria-label="Range"
			value={[String(value)]}
			onValueChange={(next) => {
				const range = ranges.find((r) => String(r) === next[0]);
				if (range !== undefined) onValueChange(range);
			}}
		>
			{ranges.map((range) => (
				<ToggleGroupItem
					key={range}
					value={String(range)}
					aria-label={long(range)}
					className="aria-pressed:bg-primary aria-pressed:text-primary-foreground"
				>
					{short(range)}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

/** The color square of a chart series, in a tooltip or a table. */
export function Swatch({ color }: { color: string | undefined }) {
	return (
		<span
			className="size-2.5 shrink-0 rounded-[2px] bg-(--swatch)"
			style={{ "--swatch": color } as CSSProperties}
		/>
	);
}
