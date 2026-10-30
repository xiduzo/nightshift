import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, ZapIcon } from "lucide-react";
import { RunList } from "@/features/runs";
import type { DashboardSummary } from "@/shared/api";
import { formatKnownCost } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { formatNight } from "./nights";
import { OVERVIEW_ROWS } from "./overview";

/**
 * The latest night with runs, newest first and at most {@link OVERVIEW_ROWS},
 * as a run list with the time each started. What there is to review in the
 * morning. The heading still counts the whole night.
 */
export function NightOutput({
	projectId,
	lastNight,
	isLoading,
	onQuickRun,
	className,
}: {
	projectId: string;
	/** Null without runs; undefined while it loads. */
	lastNight: DashboardSummary["lastNight"] | undefined;
	isLoading: boolean;
	onQuickRun: () => void;
	className?: string;
}) {
	const night = lastNight?.night ?? null;
	const count = lastNight?.runs ?? 0;

	return (
		<PageSection
			title="What the night produced"
			description={
				night === null
					? "Runs and their branches, to review in the morning."
					: `Night of ${formatNight(night)}, ${count} ${count === 1 ? "run" : "runs"}, ${formatKnownCost(lastNight?.cost ?? { costUsd: 0 })}`
			}
			className={className}
			actions={
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={
						<Link to="/projects/$projectId/runs" params={{ projectId }} />
					}
				>
					All runs
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			}
		>
			<Card className="py-0">
				<CardContent className="px-0">
					<RunList
						runs={lastNight?.latest}
						isLoading={isLoading}
						clockTimes
						emptyDescription="Run a flow or start a quick run. What it makes shows up here."
						emptyAction={
							<Button onClick={onQuickRun}>
								<ZapIcon data-icon="inline-start" />
								Quick run
							</Button>
						}
					/>
				</CardContent>
			</Card>
		</PageSection>
	);
}
