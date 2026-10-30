import type { ReactNode } from "react";

/** A table cell of two lines: the value, and a quiet line under it. */
export function CellLines({
	children,
	sub,
	align = "start",
}: {
	children: ReactNode;
	sub?: ReactNode;
	align?: "start" | "end";
}) {
	return (
		<div
			className={
				align === "end"
					? "flex flex-col items-end gap-1"
					: "flex flex-col items-start gap-1"
			}
		>
			<span className="text-sm">{children}</span>
			{sub ? (
				<span className="text-muted-foreground text-xs">{sub}</span>
			) : null}
		</div>
	);
}

/** Under a table that shows its top rows: how many more the full list has. */
export function MoreRows({ hidden, noun }: { hidden: number; noun: string }) {
	if (hidden <= 0) return null;
	return (
		<p className="border-t px-6 py-3 text-muted-foreground text-xs">
			{hidden === 1 ? `1 more ${noun}` : `${hidden} more ${noun}s`} in the full
			list.
		</p>
	);
}
