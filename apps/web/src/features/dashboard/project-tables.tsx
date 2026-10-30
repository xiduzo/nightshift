import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import type { NightsRange, Project } from "@/shared/api";
import { FailuresTable } from "./failures-table";
import { FlowHealthTable } from "./flow-health";
import { GatesTable } from "./gates-table";
import { SpendTable } from "./spend-table";

type Tab = "flows" | "failures" | "gates" | "spend";

/**
 * The lists under the chart, over the page's range, one tab each: how the
 * flows do, the runs that failed, the Gates the flows asked and what they
 * spent. Each shows its top rows. The full list is one link away.
 */
export function ProjectTables({
	project,
	range,
}: {
	project: Project;
	/** Undefined while it loads. */
	range: NightsRange | undefined;
}) {
	const [tab, setTab] = useState<Tab>("flows");
	const failed = range?.runs.failed;

	return (
		<Card className="py-0">
			<CardContent className="px-0">
				<Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
					<div className="flex items-center justify-between gap-2 px-4 pt-2">
						<TabsList variant="line">
							<TabsTrigger value="flows">Flows</TabsTrigger>
							<TabsTrigger value="failures">
								Failures
								{failed && failed.count > 0 ? (
									<Badge variant="secondary" className="tabular-nums">
										{failed.count}
									</Badge>
								) : null}
							</TabsTrigger>
							<TabsTrigger value="gates">Gates</TabsTrigger>
							<TabsTrigger value="spend">Spend</TabsTrigger>
						</TabsList>
						<TabLink tab={tab} projectId={project.id} />
					</div>

					<TabsContent value="flows">
						<FlowHealthTable project={project} rows={range?.flows?.rows} />
					</TabsContent>

					<TabsContent value="failures">
						{range ? (
							<FailuresTable failed={range.runs.failed} nights={range.nights} />
						) : null}
					</TabsContent>

					<TabsContent value="gates">
						{range ? <GatesTable groups={range.gates.groups} /> : null}
					</TabsContent>

					<TabsContent value="spend">
						{range ? <SpendTable spend={range.spend} /> : null}
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}

/** The full list of the open tab, one link away. */
function TabLink({ tab, projectId }: { tab: Tab; projectId: string }) {
	const link =
		tab === "flows"
			? {
					label: "Flows",
					render: (
						<Link to="/projects/$projectId/flows" params={{ projectId }} />
					),
				}
			: tab === "gates"
				? { label: "Inbox", render: <Link to="/inbox" /> }
				: {
						label: "All runs",
						render: (
							<Link to="/projects/$projectId/runs" params={{ projectId }} />
						),
					};
	return (
		<Button variant="ghost" size="sm" nativeButton={false} render={link.render}>
			{link.label}
			<ArrowRightIcon data-icon="inline-end" />
		</Button>
	);
}
