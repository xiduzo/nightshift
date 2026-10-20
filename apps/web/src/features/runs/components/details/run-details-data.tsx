/** The data of a run in its details: the inputs it started with, and its variables. */
import { Badge } from "@nightshift/ui/components/badge";
import { useMemo } from "react";
import { InspectorSection } from "@/features/flows";
import type { RunDetail, StepSummary } from "@/shared/api";
import { previewValue, variableGroups } from "../../lib/run-variables";
import { ScopeTitle, SetBy, TYPE_LABEL, ValuePreview } from "../run-variables";
import { Count, Fact } from "./run-facts";

/** The values the run started with. Left out when the flow has no inputs. */
export function InputsSection({ run }: { run: RunDetail }) {
	const inputs = Object.entries(run.inputs ?? {});
	if (inputs.length === 0) return null;
	return (
		<InspectorSection title="Inputs" aside={<Count n={inputs.length} />}>
			<dl className="flex flex-col gap-3">
				{inputs.map(([name, value]) => (
					<Fact key={name} label={name} mono>
						<span
							className="truncate font-mono text-xs"
							title={previewValue(value, 400)}
						>
							<ValuePreview value={value} />
						</span>
					</Fact>
				))}
			</dl>
		</InspectorSection>
	);
}

/**
 * Each variable's value now, per flow the run ran, and the step that set
 * it. Left out while the run has no variables.
 */
export function VariablesSection({
	run,
	steps,
	onShowStep,
}: {
	run: RunDetail;
	steps: StepSummary[];
	onShowStep: (stepId: string) => void;
}) {
	const groups = useMemo(() => variableGroups(run, steps), [run, steps]);
	if (groups.length === 0) return null;
	const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
	return (
		<InspectorSection title="Variables" aside={<Count n={count} />}>
			{groups.map((group) => (
				<section key={group.key} className="flex flex-col gap-3">
					{groups.length > 1 ? (
						<h4 className="text-muted-foreground text-xs">
							{group.scope ? (
								<ScopeTitle run={run} steps={steps} scope={group.scope} />
							) : (
								<span className="font-mono">{run.flowName ?? "This run"}</span>
							)}
						</h4>
					) : null}
					<dl className="flex flex-col gap-3">
						{group.rows.map((row) => (
							<div key={row.name} className="flex min-w-0 flex-col gap-1">
								<dt className="flex items-center gap-1.5 text-xs">
									<span className="truncate font-mono text-muted-foreground">
										{row.name}
									</span>
									{row.type ? (
										<Badge variant="outline">{TYPE_LABEL[row.type]}</Badge>
									) : null}
									<span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
										{row.last.stepId === null ? null : "Set by"}
										<SetBy
											change={row.last}
											steps={steps}
											onShowStep={onShowStep}
										/>
									</span>
								</dt>
								<dd className="min-w-0 truncate font-mono text-sm">
									<ValuePreview value={row.last.value} />
								</dd>
							</div>
						))}
					</dl>
				</section>
			))}
		</InspectorSection>
	);
}
