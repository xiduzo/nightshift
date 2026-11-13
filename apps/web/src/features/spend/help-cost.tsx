import type { SpendDays } from "@nightshift/client";
import { builtinAgent } from "@nightshift/flows";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { formatCost } from "@/shared/format";
import { PageSection } from "@/shared/page";

/**
 * Help: what Night Shift's own agents cost over the page's range, apart
 * from the runs. One card with the total, then one line per agent that
 * answered, the most cost first. The Decider and the Brief writer are not
 * here: they work in a run, and the run has their cost.
 */
export function HelpCost({ days }: { days: SpendDays }) {
	const { help } = days;
	return (
		<PageSection
			title="Help"
			description="What Night Shift's agents cost when they build, explain and suggest. This is not part of a run's cost."
		>
			{help.answers === 0 ? (
				<p className="rounded-md border border-dashed px-4 py-10 text-center text-muted-foreground text-sm">
					No help in the last {days.nights} days. Ask an agent to build a flow,
					explain a run or fill a field, and its cost shows here.
				</p>
			) : (
				<Card size="sm">
					<CardHeader>
						<CardDescription className="flex items-baseline gap-2">
							<span className="flex-1">
								Help in the last {days.nights} days
							</span>
							<span className="text-xs tabular-nums">
								{answers(help.answers)}
							</span>
						</CardDescription>
						<CardTitle className="font-semibold text-2xl tabular-nums tracking-tight">
							{formatCost(help.total)}
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-2">
						<ul className="flex flex-col gap-1.5 text-sm">
							{help.agents.map((agent) => (
								<li key={agent.agent} className="flex items-baseline gap-2">
									<span className="min-w-0 flex-1 truncate">
										{builtinAgent(agent.agent).name}
									</span>
									<span className="text-muted-foreground text-xs tabular-nums">
										{answers(agent.answers)}
									</span>
									<span className="shrink-0 text-right font-medium tabular-nums">
										{formatCost(agent.costUsd)}
									</span>
								</li>
							))}
						</ul>
						{help.unknown > 0 ? (
							<p className="text-muted-foreground text-xs">
								{help.unknown === 1
									? "1 answer did not report its cost."
									: `${help.unknown} answers did not report their cost.`}{" "}
								The total does not include {help.unknown === 1 ? "it" : "them"}.
							</p>
						) : null}
					</CardContent>
				</Card>
			)}
		</PageSection>
	);
}

/** "1 answer", "12 answers". */
function answers(count: number): string {
	return `${count} ${count === 1 ? "answer" : "answers"}`;
}
