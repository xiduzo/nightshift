import {
	type SpendDays,
	type SpendSaving,
	savingTitle,
	savingWhy,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Progress } from "@nightshift/ui/components/progress";
import { Link } from "@tanstack/react-router";
import { CircleCheckIcon } from "lucide-react";
import { chatAboutSaving } from "@/features/flows";
import { AgentButton } from "@/shared/agent-button";
import { formatCost } from "@/shared/format";
import { PageSection } from "@/shared/page";

/** The ways to save the list shows. The rest are in the rows of their flows. */
const SHOWN = 5;

/**
 * The ways to save over the page's range, the most saved first: what they
 * add up to against the spend, then one item per change with the runs
 * that show it. Each is read from the runs, never a guess.
 */
export function WaysToSave({
	days,
	projectName,
}: {
	days: SpendDays;
	/** Undefined for a project that is gone: its flow has no link. */
	projectName: (projectId: string) => string | undefined;
}) {
	const shown = days.savings.slice(0, SHOWN);
	const rest = days.savings.slice(SHOWN);
	const share = days.total > 0 ? (days.saves / days.total) * 100 : 0;
	return (
		<PageSection
			title="Ways to save"
			description={`What each change could have saved in the last ${days.nights} days. The biggest first.`}
		>
			{shown.length === 0 ? (
				<p className="rounded-md border border-dashed px-4 py-10 text-center text-muted-foreground text-sm">
					No way to save in the last {days.nights} days. Each run finished, did
					work, and cost near a usual run.
				</p>
			) : (
				<>
					<Item className="bg-status-finished/10 text-status-finished">
						<ItemContent className="gap-2">
							<span className="flex items-baseline gap-2">
								<span className="font-semibold text-xl tabular-nums tracking-tight">
									{formatCost(days.saves)}
								</span>
								<span className="text-sm tabular-nums">
									of {formatCost(days.total)} · {Math.round(share)}%
								</span>
							</span>
							<Progress
								value={share}
								aria-label="Share of the spend a change could save"
								className="**:data-[slot=progress-indicator]:bg-status-finished **:data-[slot=progress-track]:bg-background"
							/>
							<span className="text-xs">
								With each change, these {days.nights} days cost about{" "}
								{formatCost(Math.max(days.total - days.saves, 0))}.
							</span>
						</ItemContent>
					</Item>
					<ItemGroup className="gap-3">
						{shown.map((saving, index) => (
							<SavingItem
								key={saving.key}
								saving={saving}
								rank={index + 1}
								range={days.nights}
								project={projectName(saving.projectId)}
							/>
						))}
					</ItemGroup>
					{rest.length > 0 ? (
						<p className="px-1 text-muted-foreground text-sm">
							{rest.length} smaller{" "}
							{rest.length === 1 ? "way saves" : "ways save"}{" "}
							{formatCost(rest.reduce((sum, saving) => sum + saving.saves, 0))}{" "}
							together. Open a flow in the list to see them.
						</p>
					) : null}
				</>
			)}
		</PageSection>
	);
}

/** One way to save: what to do, on which flow, what it saves, and the runs that show it. */
function SavingItem({
	saving,
	rank,
	range,
	project,
}: {
	saving: SpendSaving;
	rank: number;
	range: number;
	project: string | undefined;
}) {
	return (
		<Item variant="outline" role="listitem">
			<ItemMedia>
				<Badge
					variant={rank === 1 ? "default" : "secondary"}
					className="size-5.5 rounded-full px-0 tabular-nums"
				>
					{rank}
				</Badge>
			</ItemMedia>
			<ItemContent>
				<ItemTitle className="line-clamp-none">{savingTitle(saving)}</ItemTitle>
				<ItemDescription className="text-xs">
					<span className="font-mono">{saving.flow}</span>
					{project ? ` · ${project}` : null}
				</ItemDescription>
				<ItemDescription className="line-clamp-none pt-1">
					{savingWhy(saving, formatCost)}
				</ItemDescription>
			</ItemContent>
			<ItemContent className="items-end gap-0 self-start">
				<span className="font-semibold text-base tabular-nums">
					{formatCost(saving.saves)}
				</span>
				<span className="text-muted-foreground text-xs">in {range} days</span>
			</ItemContent>
			<ItemFooter className="flex-wrap pl-9">
				<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
					<CircleCheckIcon className="size-3" aria-hidden="true" />
					Seen in {saving.runs} {saving.runs === 1 ? "run" : "runs"}
				</span>
				<SavingActions
					saving={saving}
					linked={project !== undefined}
					primary={rank === 1}
				/>
			</ItemFooter>
		</Item>
	);
}

/**
 * Where a way to save leads: the newest run that shows it, the flow to
 * change, and a chat in that flow where an agent reads the run and
 * proposes the change.
 */
export function SavingActions({
	saving,
	linked,
	primary = false,
}: {
	saving: SpendSaving;
	/** The project of the flow is still there. */
	linked: boolean;
	primary?: boolean;
}) {
	return (
		<span className="flex flex-wrap justify-end gap-2">
			<Button
				size="xs"
				variant="ghost"
				nativeButton={false}
				render={<Link to="/runs/$runId" params={{ runId: saving.runId }} />}
			>
				Open the run
			</Button>
			{linked ? (
				<>
					<Button
						size="xs"
						variant="outline"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId: saving.projectId, name: saving.flow }}
							/>
						}
					>
						Open the flow
					</Button>
					<AgentButton
						entry="spend.saving"
						size="xs"
						variant={primary ? "default" : "outline"}
						title="Opens the flow with a chat. The Improver reads the run and proposes a change."
						link={
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId: saving.projectId, name: saving.flow }}
								search={{ chat: chatAboutSaving(saving) }}
							/>
						}
					/>
				</>
			) : null}
		</span>
	);
}
