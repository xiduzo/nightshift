import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { OutcomeBadge, stepState } from "@/features/flows";
import type { RunStatus, StepSummary } from "@/shared/api";
import { climbOf } from "../lib/run-steps";

/**
 * The ladder of a step of a cascade (ADR 6): each try of its climb, with
 * its tier, its try in the tier, how sure a model was, and how it ended.
 * The try that held is the last one that passed.
 */
export function StepClimb({
	steps,
	step,
	runStatus,
}: {
	steps: StepSummary[];
	step: StepSummary;
	runStatus?: RunStatus;
}) {
	const climb = climbOf(steps, step);
	if (climb.length === 0) return null;
	return (
		<section
			aria-labelledby="step-climb-heading"
			className="flex flex-col gap-2"
		>
			<h3
				id="step-climb-heading"
				className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
			>
				Cascade
			</h3>
			<ItemGroup className="gap-1">
				{climb.map((entry) => (
					<Item
						key={entry.step.id}
						variant={entry.step.id === step.id ? "muted" : "outline"}
						size="xs"
						aria-current={entry.step.id === step.id ? "step" : undefined}
					>
						<ItemContent className="min-w-0">
							<ItemTitle className="font-mono text-xs">
								{entry.tier}
								<span className="font-normal font-sans text-muted-foreground">
									try {entry.try}
								</span>
							</ItemTitle>
						</ItemContent>
						<ItemActions className="gap-2">
							{entry.confidence !== null ? (
								<span className="text-muted-foreground text-xs tabular-nums">
									{Math.round(entry.confidence * 100)}% sure
								</span>
							) : null}
							<OutcomeBadge state={stepState(entry.step, runStatus)} />
						</ItemActions>
					</Item>
				))}
			</ItemGroup>
		</section>
	);
}
