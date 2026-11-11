import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { ChevronRightIcon } from "lucide-react";
import type { StepSummary } from "@/shared/api";
import { CodeView, formatJson, JsonBlock } from "@/shared/code";
import { jsonOutput } from "../lib/run-steps";

/**
 * The outputs later nodes can read from the step, one row each: the field
 * and its value on one line. A row opens on the whole value.
 */
export function StepOutputs({ step }: { step: StepSummary }) {
	const outputs = Object.entries(step.outputs);
	if (outputs.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				{step.outcome === null
					? "The step has not ended yet."
					: "This step left no outputs."}
			</p>
		);
	}
	return (
		<ul className="flex flex-col divide-y rounded-lg border">
			{outputs.map(([field, value]) => {
				const json = jsonOutput(value);
				const text = json !== undefined ? formatJson(json) : String(value);
				return (
					<li key={field}>
						<Collapsible>
							<CollapsibleTrigger
								className="group/output flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
								title={`{{${step.nodeId}.${field}}}`}
							>
								<ChevronRightIcon
									aria-hidden="true"
									className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open/output:rotate-90 motion-reduce:transition-none"
								/>
								<span className="shrink-0 font-mono text-muted-foreground">
									{field}
								</span>
								<span className="min-w-0 flex-1 truncate font-mono group-data-panel-open/output:invisible">
									{text.replace(/\s+/g, " ") || (
										<span className="text-muted-foreground italic">empty</span>
									)}
								</span>
							</CollapsibleTrigger>
							<CollapsibleContent className="px-2.5 pb-2.5">
								{json !== undefined ? (
									<JsonBlock value={json} />
								) : text ? (
									<CodeView code={text} language="text" />
								) : (
									<span className="text-muted-foreground text-xs italic">
										empty
									</span>
								)}
							</CollapsibleContent>
						</Collapsible>
					</li>
				);
			})}
		</ul>
	);
}
