import { CodeBlockLine } from "@nightshift/ui/components/code-block";
import { cn } from "@nightshift/ui/lib/utils";
import type { ReactNode } from "react";

/** How a line of a diff reads: added, removed, or kept as it was. */
export type DiffLineVariant = "added" | "removed" | "default";

/**
 * One line of a diff in a code block. The generated `added` line takes the
 * muted background, so an added line here takes a green tint and a green
 * "+", the way a removed line takes the destructive red.
 */
export function DiffLine({
	variant,
	children,
	className,
}: {
	variant: DiffLineVariant;
	children: ReactNode;
	className?: string;
}) {
	return (
		<CodeBlockLine
			variant={variant}
			className={cn(
				variant === "added" &&
					"bg-green-600/10 after:text-green-700 dark:bg-green-400/10 dark:after:text-green-400",
				className,
			)}
		>
			{children}
		</CodeBlockLine>
	);
}
