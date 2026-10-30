/**
 * PROTOTYPE, throw away. The page-wide range of the project dashboard, after
 * the range row of Google Search Console: a row of preset buttons, "More"
 * for a dialog with longer and custom ranges, and a compare switch. The range
 * and compare live in the URL (`?range=7&compare=1`), so every section of the
 * page reads the same one.
 */

import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CheckIcon, ChevronDownIcon, GitCompareArrowsIcon } from "lucide-react";
import { useState } from "react";

/** "24h" reads the hours of the last day; the others read whole nights. */
export type DashboardRange = "24h" | 7 | 30 | 90;

const PRESETS: { value: DashboardRange; label: string }[] = [
	{ value: "24h", label: "24 hours" },
	{ value: 7, label: "7 nights" },
	{ value: 30, label: "30 nights" },
	{ value: 90, label: "90 nights" },
];

function parseRange(raw: string | undefined): DashboardRange {
	if (raw === "24h") return "24h";
	const nights = Number(raw);
	return nights === 7 || nights === 30 || nights === 90 ? nights : 7;
}

/** The page-wide range and compare switch, from the URL. */
export function useDashboardRange() {
	const search = useSearch({ strict: false }) as {
		range?: string;
		compare?: string;
	};
	const navigate = useNavigate();
	const range = parseRange(search.range);
	const compare = search.compare === "1";
	const set = (next: { range?: DashboardRange; compare?: boolean }) =>
		void navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				range: String(next.range ?? range),
				compare: (next.compare ?? compare) ? "1" : undefined,
			}),
			replace: true,
		});
	return { range, compare, set };
}

/** "7 nights", "the last 24 hours". */
export function rangeLabel(range: DashboardRange): string {
	return range === "24h" ? "the last 24 hours" : `the last ${range} nights`;
}

export function RangeBar({ className }: { className?: string }) {
	const { range, compare, set } = useDashboardRange();
	const [more, setMore] = useState(false);

	return (
		<div className={className}>
			<div className="flex flex-wrap items-center gap-2">
				<ButtonGroup aria-label="Range">
					{PRESETS.map((preset) => {
						const active = preset.value === range;
						return (
							<Button
								key={preset.label}
								variant={active ? "secondary" : "outline"}
								size="sm"
								aria-pressed={active}
								onClick={() => set({ range: preset.value })}
							>
								{active ? <CheckIcon data-icon="inline-start" /> : null}
								{preset.label}
							</Button>
						);
					})}
					<Button variant="outline" size="sm" onClick={() => setMore(true)}>
						More
						<ChevronDownIcon data-icon="inline-end" />
					</Button>
				</ButtonGroup>
				<Button
					variant={compare ? "secondary" : "outline"}
					size="sm"
					aria-pressed={compare}
					onClick={() => set({ compare: !compare })}
				>
					<GitCompareArrowsIcon data-icon="inline-start" />
					{compare ? "Compared with the nights before" : "Compare"}
				</Button>
			</div>
			<MoreRangesDialog open={more} onOpenChange={setMore} />
		</div>
	);
}

/** PROTOTYPE: longer and custom ranges are not in the numbers yet. */
function MoreRangesDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Range</DialogTitle>
					<DialogDescription>
						Prototype: Night Shift counts 90 nights at most for now.
					</DialogDescription>
				</DialogHeader>
				<Tabs defaultValue="filter">
					<TabsList variant="line">
						<TabsTrigger value="filter">Filter</TabsTrigger>
						<TabsTrigger value="compare">Compare</TabsTrigger>
					</TabsList>
					<TabsContent value="filter" className="flex flex-col gap-4 pt-4">
						<RadioGroup defaultValue="custom">
							{["Last 6 months", "Last 12 months", "Custom"].map((label) => (
								<div key={label} className="flex items-center gap-3">
									<RadioGroupItem value={label.toLowerCase()} id={label} />
									<Label htmlFor={label}>{label}</Label>
								</div>
							))}
						</RadioGroup>
						<div className="grid grid-cols-2 gap-2 pl-7">
							<Input type="date" aria-label="First night" />
							<Input type="date" aria-label="Last night" />
						</div>
					</TabsContent>
					<TabsContent value="compare" className="flex flex-col gap-3 pt-4">
						<RadioGroup defaultValue="before">
							{[
								["before", "With the nights before"],
								["week", "With the same nights last week"],
								["flow", "One flow with another"],
							].map(([value, label]) => (
								<div key={value} className="flex items-center gap-3">
									<RadioGroupItem value={value} id={value} />
									<Label htmlFor={value}>{label}</Label>
								</div>
							))}
						</RadioGroup>
					</TabsContent>
				</Tabs>
				<DialogFooter>
					<DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
					<Button disabled>Apply</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
