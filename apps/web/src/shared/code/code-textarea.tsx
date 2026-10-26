import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { type ComponentProps, Fragment, type ReactNode, useRef } from "react";

import { useHighlightedCode } from "./use-highlighted-code";

// The textarea and the code behind it must lay out the text the same way.
const TEXT =
	"whitespace-pre-wrap px-2.5 py-2 text-base [overflow-wrap:break-word] [scrollbar-gutter:stable] md:text-sm";

/**
 * A shadcn Textarea that highlights its code with Shiki. The text sits in a
 * layer behind a transparent textarea, so typing, selecting, undo and every
 * key handler work as in a plain textarea. `marks` puts a soft background
 * behind each match, such as `{{templates}}`. Without a `language` only the
 * marks show.
 */
export function CodeTextarea({
	value,
	language = "text",
	marks,
	className,
	onScroll,
	...props
}: Omit<ComponentProps<typeof Textarea>, "value"> & {
	value: string;
	language?: string;
	/** A global pattern; each match gets a background. */
	marks?: RegExp;
}) {
	const behind = useRef<HTMLDivElement>(null);
	const lines = useHighlightedCode(value, language);
	// A last empty line still takes a line in the textarea.
	const end = value.endsWith("\n") ? "\n​" : null;

	return (
		<div className="relative grid rounded-md dark:bg-input/30">
			<div
				ref={behind}
				aria-hidden="true"
				className={cn(
					TEXT,
					"pointer-events-none absolute inset-0 grid overflow-hidden border border-transparent *:col-start-1 *:row-start-1",
					className,
				)}
			>
				{marks ? (
					<div className="text-transparent">
						{markText(value, marks)}
						{end}
					</div>
				) : null}
				<div>
					{lines.map((line, index) => (
						<Fragment key={index}>
							{index > 0 ? "\n" : null}
							{line}
						</Fragment>
					))}
					{end}
				</div>
			</div>
			<Textarea
				value={value}
				className={cn(
					TEXT,
					"relative bg-transparent text-transparent caret-foreground selection:bg-primary/25 dark:bg-transparent",
					className,
				)}
				onScroll={(event) => {
					if (behind.current) {
						behind.current.scrollTop = event.currentTarget.scrollTop;
						behind.current.scrollLeft = event.currentTarget.scrollLeft;
					}
					onScroll?.(event);
				}}
				{...props}
			/>
		</div>
	);
}

function markText(text: string, pattern: RegExp): ReactNode[] {
	const parts: ReactNode[] = [];
	let at = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index ?? 0;
		parts.push(text.slice(at, start));
		parts.push(
			<mark key={start} className="rounded-sm bg-primary/15 text-transparent">
				{match[0]}
			</mark>,
		);
		at = start + match[0].length;
	}
	parts.push(text.slice(at));
	return parts;
}
