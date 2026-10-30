import { CodeBlockLine } from "@nightshift/ui/components/code-block";
import { cn } from "@nightshift/ui/lib/utils";
import type { ReactNode } from "react";

import { useHighlightedCode } from "./use-highlighted-code";

/** How a line of a diff reads: added, removed, or kept as it was. */
export type DiffLineVariant = "added" | "removed" | "default";

/**
 * One line of a diff in a code block. The generated `added` line takes the
 * muted background, so an added line here takes a green tint and a green
 * "+", the way a removed line takes the destructive red.
 */
function DiffLine({
	variant,
	children,
}: {
	variant: DiffLineVariant;
	children: ReactNode;
}) {
	return (
		<CodeBlockLine
			variant={variant}
			className={cn(
				variant === "added" &&
					"bg-green-600/10 after:text-green-700 dark:bg-green-400/10 dark:after:text-green-400",
			)}
		>
			{children}
		</CodeBlockLine>
	);
}

/**
 * The lines of a diff, for a `CodeBlockContent`: each marked added or
 * removed, and highlighted by Shiki in `language` once it loads. A language
 * Shiki does not know (such as "text") shows the plain lines.
 */
export function DiffLines({
	lines,
	language = "text",
}: {
	lines: readonly { variant: DiffLineVariant; text: string }[];
	language?: string;
}) {
	const highlighted = useHighlightedCode(
		lines.map((line) => line.text).join("\n"),
		language,
	);
	return lines.map((line, index) => (
		// A diff does not change while it shows.
		<DiffLine key={index} variant={line.variant}>
			{highlighted[index] ?? line.text}
		</DiffLine>
	));
}
