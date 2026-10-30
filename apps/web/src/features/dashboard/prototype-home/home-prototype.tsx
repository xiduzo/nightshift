/**
 * PROTOTYPE, throw away. Home after the project page's Search Console
 * shape, four ways, switchable with `?variant=`. `now` is today's Home.
 * One range for the page (`?range=`), always against the nights before.
 */

import { Button } from "@nightshift/ui/components/button";
import type { NightRange } from "@/shared/api";
import { SiteHeader } from "@/shared/page";
import { PrototypeSwitcher } from "@/shared/prototype-switcher";
import { HomePage } from "../home-page";
import { useHomeData } from "./home-data";
import { needsYouFromHome, sampleNeedsYou } from "./needs-you-data";
import { VariantByProject } from "./variant-by-project";
import { VariantConsole } from "./variant-console";
import { VariantNeedsYou } from "./variant-needs-you";
import {
	VariantByCause,
	VariantFeed,
	VariantLanes,
} from "./variant-needs-you-more";
import { VariantSideBySide } from "./variant-side-by-side";

export const HOME_VARIANTS = [
	{ key: "now", name: "Today's Home" },
	{ key: "A", name: "Console" },
	{ key: "B", name: "Side by side" },
	{ key: "C", name: "Needs you first" },
	{ key: "C2", name: "Needs you · one feed" },
	{ key: "C3", name: "Needs you · by cause" },
	{ key: "C4", name: "Needs you · three lanes" },
	{ key: "D", name: "By project" },
] as const;

export function HomePrototype({
	variant = "A",
	range,
	onRangeChange,
	sample,
	onSampleChange,
}: {
	variant?: string;
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
	/** The C variants show made-up data, a lot of it. */
	sample: boolean;
	onSampleChange: (sample: boolean) => void;
}) {
	const data = useHomeData(range);
	const props = { data, range, onRangeChange };
	const needsYou = {
		data: sample ? sampleNeedsYou(range) : needsYouFromHome(data),
		range,
		onRangeChange,
	};
	const switcher = (
		<PrototypeSwitcher variants={HOME_VARIANTS} current={variant}>
			{variant.startsWith("C") ? (
				<Button
					size="sm"
					variant={sample ? "secondary" : "ghost"}
					className="rounded-full"
					onClick={() => onSampleChange(!sample)}
				>
					{sample ? "Sample data" : "Real data"}
				</Button>
			) : null}
		</PrototypeSwitcher>
	);

	if (variant === "now") {
		return (
			<>
				<HomePage />
				{switcher}
			</>
		);
	}
	return (
		<>
			<SiteHeader crumbs={[{ label: "Home" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 pb-20 md:p-6 md:pb-20">
				{variant === "B" ? (
					<VariantSideBySide {...props} />
				) : variant === "C" ? (
					<VariantNeedsYou {...needsYou} />
				) : variant === "C2" ? (
					<VariantFeed {...needsYou} />
				) : variant === "C3" ? (
					<VariantByCause {...needsYou} />
				) : variant === "C4" ? (
					<VariantLanes {...needsYou} />
				) : variant === "D" ? (
					<VariantByProject {...props} />
				) : (
					<VariantConsole {...props} />
				)}
			</div>
			{switcher}
		</>
	);
}
