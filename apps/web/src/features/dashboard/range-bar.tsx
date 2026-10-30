import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import type { NightRange } from "@/shared/api";

/** The ranges of a project's page, as the dashboard numbers have them. */
export const PAGE_RANGES = [7, 30, 90] as const satisfies NightRange[];

/**
 * The range of a whole project page, after the range row of Search
 * Console: one row of presets on top, and every number under it follows.
 */
export function RangeBar({
	value,
	onValueChange,
}: {
	value: NightRange;
	onValueChange: (range: NightRange) => void;
}) {
	return (
		<ToggleGroup
			variant="outline"
			size="sm"
			spacing={0}
			aria-label="Range"
			value={[String(value)]}
			onValueChange={(next) => {
				const range = PAGE_RANGES.find((nights) => String(nights) === next[0]);
				if (range) onValueChange(range);
			}}
		>
			{PAGE_RANGES.map((nights) => (
				<ToggleGroupItem
					key={nights}
					value={String(nights)}
					className="aria-pressed:bg-secondary"
				>
					{nights} nights
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
