import { cn } from "@nightshift/ui/lib/utils";
import { SparklesIcon } from "lucide-react";

/** A quiet note on a part of a Gate's brief that a model wrote, not the flow. */
export function WrittenByModel({
	children = "Written by Night Shift",
	className,
}: {
	children?: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 font-normal text-muted-foreground text-xs normal-case tracking-normal",
				className,
			)}
		>
			<SparklesIcon className="size-3" aria-hidden="true" />
			{children}
		</span>
	);
}
