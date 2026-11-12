import { markdownPreview } from "@nightshift/client";
import { cn } from "@nightshift/ui/lib/utils";
import { Markdown } from "@/shared/markdown";

/**
 * The start of a report, where it opens on its run's page: its Markdown
 * in a few lines' height (a hover card), or `plain` lines without marks
 * for a tight place (a flow's card). Images show as links.
 */
export function ReportPreview({
	text,
	more = false,
	plain = false,
	className,
}: {
	/** The excerpt of the report. */
	text: string;
	/** The report goes on after `text`. */
	more?: boolean;
	plain?: boolean;
	className?: string;
}) {
	if (plain) {
		return (
			<p
				className={cn(
					"line-clamp-3 whitespace-pre-line break-words text-muted-foreground text-xs leading-relaxed",
					className,
				)}
			>
				{markdownPreview(text, 400)}
			</p>
		);
	}
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div className="max-h-56 overflow-hidden">
				<Markdown text={text} imagesAsLinks className="max-w-none text-xs" />
			</div>
			{more ? (
				<p className="text-muted-foreground text-xs">
					Open the run to read all of it.
				</p>
			) : null}
		</div>
	);
}
