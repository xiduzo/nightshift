import { Button } from "@nightshift/ui/components/button";
import { cn } from "@nightshift/ui/lib/utils";

/**
 * Messages to send with one click, in a row that scrolls sideways (the AI
 * Elements Suggestion). It sits above a Prompt Input. `wrap` puts them on
 * more rows instead, for a narrow place such as a popover, where a chip cut
 * off at the edge looks broken. A label too long for the width is truncated
 * there, and shows in full on hover.
 */
export function Suggestions({
	items,
	disabled = false,
	wrap = false,
	onPick,
	className,
}: {
	items: readonly string[];
	disabled?: boolean;
	wrap?: boolean;
	onPick: (item: string) => void;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex gap-2",
				wrap
					? "flex-wrap"
					: "no-scrollbar scroll-fade-x overflow-x-auto overscroll-x-contain",
				className,
			)}
		>
			{items.map((item) => (
				<Button
					key={item}
					variant="outline"
					size="sm"
					className={cn(
						"font-normal",
						wrap ? "min-w-0 max-w-full" : "shrink-0",
					)}
					title={wrap ? item : undefined}
					disabled={disabled}
					onClick={() => onPick(item)}
				>
					{wrap ? <span className="truncate">{item}</span> : item}
				</Button>
			))}
		</div>
	);
}
