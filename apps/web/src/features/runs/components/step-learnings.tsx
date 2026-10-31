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
import { LightbulbIcon } from "lucide-react";
import { LEARNINGS_NEXT, LEARNINGS_TITLE } from "../lib/step-learnings";

/**
 * What the step's agent proposed to learn about the project, as the AI
 * Elements Task: a title that counts the notes, opening on the notes and
 * what happens to them next. The Gate of Review learnings uses
 * the same words.
 */
export function StepLearnings({ notes }: { notes: string[] }) {
	return (
		<section aria-label="Learnings">
			<Trace>
				<TraceCollapsible defaultOpen>
					<TraceCollapsibleTrigger>
						<TraceLine>
							<TraceIcon>
								<LightbulbIcon />
							</TraceIcon>
							<TraceTitle className="font-medium text-foreground">
								{LEARNINGS_TITLE}
							</TraceTitle>
							<TraceDescription className="tabular-nums">
								{notes.length === 1 ? "1 note" : `${notes.length} notes`}
							</TraceDescription>
						</TraceLine>
					</TraceCollapsibleTrigger>
					<TraceCollapsibleContent>
						<ul className="flex list-disc flex-col gap-1.5 pl-4 text-foreground text-sm marker:text-muted-foreground">
							{notes.map((note, index) => (
								<li key={index} className="break-words">
									{note}
								</li>
							))}
						</ul>
						<p className="pt-2 text-xs">{LEARNINGS_NEXT}</p>
					</TraceCollapsibleContent>
				</TraceCollapsible>
			</Trace>
		</section>
	);
}
