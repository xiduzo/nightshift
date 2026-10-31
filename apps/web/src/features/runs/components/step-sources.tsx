import { Badge } from "@nightshift/ui/components/badge";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@nightshift/ui/components/trace";
import { BookOpenIcon } from "lucide-react";
import type { StepSummary } from "@/shared/api";

type Source = NonNullable<StepSummary["sources"]>[number];

/** Where in the file: its section, and the page of a PDF. */
function spotOf(source: Source): string | null {
	const parts = [
		source.section,
		source.page !== null ? `page ${source.page}` : null,
	].filter((part): part is string => part !== null && part !== "");
	return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The knowledge files the step's agent used, as the AI Elements Sources:
 * a title that counts them, opening on each file and the part of it, the
 * ones it read first. Night Shift takes them from the agent's searches and
 * reads: the agent cites nothing itself.
 */
export function StepSources({ sources }: { sources: Source[] }) {
	const read = sources.filter((source) => source.read).length;
	return (
		<section aria-label="Sources">
			<Trace>
				<TraceCollapsible>
					<TraceCollapsibleTrigger>
						<TraceLine>
							<TraceIcon>
								<BookOpenIcon />
							</TraceIcon>
							<TraceTitle className="font-medium text-foreground">
								Used {sources.length}{" "}
								{sources.length === 1 ? "source" : "sources"}
							</TraceTitle>
							<TraceDescription className="tabular-nums">
								{read === 1 ? "1 read" : `${read} read`}
							</TraceDescription>
						</TraceLine>
					</TraceCollapsibleTrigger>
					<TraceCollapsibleContent>
						<ul className="flex flex-col gap-2">
							{sources.map((source) => {
								const spot = spotOf(source);
								return (
									<li key={source.path} className="flex flex-col gap-0.5">
										<span className="flex flex-wrap items-center gap-2">
											<span className="break-all font-mono text-foreground text-xs">
												{source.path}
											</span>
											<Badge variant={source.read ? "secondary" : "outline"}>
												{source.read ? "Read" : "Found"}
											</Badge>
										</span>
										{spot ? <span className="text-xs">{spot}</span> : null}
									</li>
								);
							})}
						</ul>
					</TraceCollapsibleContent>
				</TraceCollapsible>
			</Trace>
		</section>
	);
}
