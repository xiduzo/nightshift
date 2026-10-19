import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	GitBranchIcon,
	MoonStarIcon,
	ZapIcon,
} from "lucide-react";
import { CostText } from "@/components/cost-text";
import { PageSection } from "@/components/page-heading";
import { RunStatusBadge } from "@/components/run-status-badge";
import type { RunSummary } from "@/lib/api-types";
import {
	formatDateTime,
	formatKnownCost,
	formatTime,
	sumKnownCost,
} from "@/lib/format";
import { formatNight, nightOf } from "@/lib/nights";

const SHOWN = 4;

/**
 * The latest night with runs, newest first and at most {@link SHOWN}: each
 * run's branch, how it ended and what it cost. What there is to review in the
 * morning. The heading still counts the whole night.
 */
export function NightOutput({
	projectId,
	runs,
	isLoading,
	onQuickRun,
	className,
}: {
	projectId: string;
	runs: RunSummary[] | undefined;
	isLoading: boolean;
	onQuickRun: () => void;
	className?: string;
}) {
	const newest = runs?.reduce<number | null>(
		(latest, run) =>
			latest === null || run.createdAt > latest ? run.createdAt : latest,
		null,
	);
	const night = newest == null ? null : nightOf(newest);
	const ofNight = (runs ?? [])
		.filter((run) => night !== null && nightOf(run.createdAt) === night)
		.sort((a, b) => b.createdAt - a.createdAt);
	const shown = ofNight.slice(0, SHOWN);
	const cost = sumKnownCost(ofNight);

	return (
		<PageSection
			title="What the night produced"
			description={
				night === null
					? "Runs and their branches, to review in the morning."
					: `Night of ${formatNight(night)}, ${ofNight.length} ${ofNight.length === 1 ? "run" : "runs"}, ${formatKnownCost(cost)}`
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
			<Card size="sm" className="py-0">
				<CardContent className="py-2">
					{isLoading ? (
						<div className="flex flex-col gap-2 py-2">
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
						</div>
					) : ofNight.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MoonStarIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No runs yet</EmptyTitle>
								<EmptyDescription>
									Run a flow or start a quick run. What it makes shows up here.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button onClick={onQuickRun}>
									<ZapIcon data-icon="inline-start" />
									Quick run
								</Button>
							</EmptyContent>
						</Empty>
					) : (
						<ItemGroup className="gap-1">
							{shown.map((run) => (
								<Item
									key={run.id}
									size="sm"
									render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
								>
									<ItemContent className="min-w-0">
										<ItemTitle className="w-full truncate">
											{run.title}
										</ItemTitle>
										<ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs">
											<GitBranchIcon
												className="size-3 shrink-0"
												aria-hidden="true"
											/>
											<span className="truncate font-mono">{run.branch}</span>
											{run.reason ? (
												<>
													<span aria-hidden="true">·</span>
													<span className="truncate">{run.reason}</span>
												</>
											) : null}
										</ItemDescription>
									</ItemContent>
									<ItemActions className="gap-3">
										<time
											dateTime={new Date(run.createdAt).toISOString()}
											title={formatDateTime(run.createdAt)}
											className="hidden text-muted-foreground text-xs tabular-nums sm:block"
										>
											{formatTime(run.createdAt)}
										</time>
										<RunStatusBadge status={run.status} />
										<CostText
											cost={run}
											className="w-16 text-right font-medium text-xs tabular-nums"
										/>
									</ItemActions>
								</Item>
							))}
						</ItemGroup>
					)}
				</CardContent>
			</Card>
		</PageSection>
	);
}
