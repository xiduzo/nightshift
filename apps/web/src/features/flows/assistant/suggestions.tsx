import { Button } from "@nightshift/ui/components/button";
import { cn } from "@nightshift/ui/lib/utils";

/**
 * Messages to send with one click, in a row that scrolls sideways (the AI
 * Elements Suggestion). It sits above a Prompt Input.
 */
export function Suggestions({
	items,
	disabled = false,
	onPick,
	className,
}: {
	items: readonly string[];
	disabled?: boolean;
	onPick: (item: string) => void;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"no-scrollbar scroll-fade-x flex gap-2 overflow-x-auto overscroll-x-contain",
				className,
			)}
		>
			{items.map((item) => (
				<Button
					key={item}
					variant="outline"
					size="sm"
					className="shrink-0 font-normal"
					disabled={disabled}
					onClick={() => onPick(item)}
				>
					{item}
				</Button>
			))}
		</div>
	);
}
