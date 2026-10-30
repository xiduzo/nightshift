import { CodeBlockLine } from "@nightshift/ui/components/code-block";
import { cn } from "@nightshift/ui/lib/utils";
import type { CSSProperties, ReactNode } from "react";

import { leadingIndent } from "./leading-indent";
import { useHighlightedCode } from "./use-highlighted-code";

/** How a line of a diff reads: added, removed, or kept as it was. */
export type DiffLineVariant = "added" | "removed" | "default";

/**
 * One line of a diff in a code block. The generated `added` line takes the
 * muted background, so an added line here takes a green tint and a green
 * "+", the way a removed line takes the destructive red.
 *
 * An indented line hangs: when the block wraps, its next rows start at the
 * line's own indent, not at the left edge. The start padding grows by the
 * indent (on top of the code block's own padding, per size) and the first
 * row pulls back by as much, so it does not move. The "+" or "−" keeps no
 * indent.
 */
function DiffLine({
	variant,
	indent,
	children,
}: {
	variant: DiffLineVariant;
	indent: number;
	children: ReactNode;
}) {
	return (
		<CodeBlockLine
			variant={variant}
			style={
				indent > 0 ? ({ "--hang": `${indent}ch` } as CSSProperties) : undefined
			}
			className={cn(
				variant === "added" &&
					"bg-green-600/10 after:text-green-700 dark:bg-green-400/10 dark:after:text-green-400",
				indent > 0 &&
					"ps-[calc(var(--spacing)*4+var(--hang))] indent-[calc(var(--hang)*-1)] after:indent-0 group-data-[size=sm]/code-block:ps-[calc(var(--spacing)*3+var(--hang))]",
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
		<DiffLine
			key={index}
			variant={line.variant}
			indent={leadingIndent(line.text)}
		>
			{highlighted[index] ?? line.text}
		</DiffLine>
	));
}
