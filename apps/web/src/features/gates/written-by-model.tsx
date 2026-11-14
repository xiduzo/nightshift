import { WRITTEN_BY_NIGHT_SHIFT } from "@nightshift/client";
import { cn } from "@nightshift/ui/lib/utils";
import { SparklesIcon } from "lucide-react";

/** A quiet note on a part of a Gate's brief that a model wrote, not the flow. */
export function WrittenByModel({
	children = WRITTEN_BY_NIGHT_SHIFT,
	className,
}: {
	children?: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 text-xs font-normal tracking-normal text-muted-foreground normal-case",
				className,
			)}
		>
			<SparklesIcon className="size-3" aria-hidden="true" />
			{children}
		</span>
	);
}
