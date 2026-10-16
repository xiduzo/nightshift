import { cn } from "@nightshift/ui/lib/utils";

import { formatJson } from "@/lib/run-steps";

/** A JSON value, pretty-printed in a scrollable block. */
export function JsonBlock({
	value,
	className,
}: {
	value: unknown;
	className?: string;
}) {
	return (
		<pre
			className={cn(
				"max-h-64 overflow-auto whitespace-pre-wrap break-words border bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed",
				className,
			)}
		>
			{formatJson(value)}
		</pre>
	);
}

/** A JSON value behind a summary line that opens it. */
export function JsonDetails({
	summary,
	value,
	open,
}: {
	summary: string;
	value: unknown;
	open?: boolean;
}) {
	return (
		<details className="group/json text-xs" open={open}>
			<summary className="cursor-pointer select-none text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
				{summary}
			</summary>
			<JsonBlock value={value} className="mt-1" />
		</details>
	);
}
