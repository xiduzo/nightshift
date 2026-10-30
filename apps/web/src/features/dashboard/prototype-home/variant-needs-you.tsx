/**
 * PROTOTYPE, throw away. Home variant C, "Needs you first": Home as a
 * to-do. The wide column lists what waits for you and what failed, grouped
 * by project. The numbers move to a rail on the right: the range, the four
 * metrics as small lines, and the projects.
 */

import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { ItemGroup } from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CircleXIcon, HourglassIcon } from "lucide-react";
import { PageHeading } from "@/shared/page";
import {
	FailureItem,
	failuresByProject,
	GateItem,
	type NeedsYouProps,
	NumbersRail,
	ProjectsCard,
	useMetricDetails,
} from "./needs-you-parts";

export function VariantNeedsYou(props: NeedsYouProps) {
	const { data, range } = props;
	const details = useMetricDetails(data, range);
	const groups = failuresByProject(data.failed.rows);

	return (
		<>
			<PageHeading
				title="Tonight"
				description={
					data.gates.length + data.failed.count === 0
						? "Nothing needs you. Your projects ran without trouble."
						: "What needs you first, then how your projects did."
				}
			/>
			<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
				<div className="flex flex-col gap-6">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<HourglassIcon className="size-4 text-status-waiting" />
								Waiting for you
								{data.gates.length > 0 ? (
									<Badge variant="secondary">{data.gates.length}</Badge>
								) : null}
							</CardTitle>
							<CardDescription>
								{data.runningCount > 0
									? `${data.runningCount} running now. `
									: ""}
								Runs pause here until you answer.
							</CardDescription>
							<CardAction>
								<Button
									variant="ghost"
									size="sm"
									nativeButton={false}
									render={<Link to="/inbox" />}
								>
									Inbox
									<ArrowRightIcon data-icon="inline-end" />
								</Button>
							</CardAction>
						</CardHeader>
						<CardContent>
							{data.gates.length === 0 ? (
								<Empty className="py-6">
									<EmptyHeader>
										<EmptyTitle>Nothing waits for you</EmptyTitle>
										<EmptyDescription>
											A Gate shows up here when a run asks you something.
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : (
								<ItemGroup className="gap-2">
									{data.gates.map((gate) => (
										<GateItem key={gate.key} gate={gate} sample={data.sample} />
									))}
								</ItemGroup>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<CircleXIcon className="size-4 text-status-failed" />
								Failed in the last {range} nights
								{data.failed.count > 0 ? (
									<Badge variant="secondary">{data.failed.count}</Badge>
								) : null}
							</CardTitle>
							<CardDescription>
								Grouped by project, the newest first.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							{groups.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No run failed in these nights.
								</p>
							) : (
								groups.map(([project, runs]) => (
									<div key={project} className="flex flex-col gap-1">
										<p className="font-medium text-sm">
											{project}{" "}
											<span className="text-muted-foreground">
												· {runs.length} failed
											</span>
										</p>
										<ItemGroup className="gap-0">
											{runs.slice(0, 4).map((run) => (
												<FailureItem
													key={run.id}
													run={run}
													sample={data.sample}
												/>
											))}
										</ItemGroup>
										{runs.length > 4 ? (
											<p className="text-muted-foreground text-xs">
												And {runs.length - 4} more
											</p>
										) : null}
									</div>
								))
							)}
						</CardContent>
					</Card>
				</div>

				<div className="flex flex-col gap-4 lg:sticky lg:top-4">
					<NumbersRail {...props} onDetails={details.open} />
					<ProjectsCard data={data} range={range} />
				</div>
			</div>
			{details.dialog}
		</>
	);
}
