/** A menu entry's label, with one line on what it does when that helps. */
export function ActionText({
	label,
	hint,
}: {
	label: string;
	hint?: string | null;
}) {
	return (
		<span className="flex flex-col">
			{label}
			{hint ? (
				<span className="text-muted-foreground text-xs">{hint}</span>
			) : null}
		</span>
	);
}
