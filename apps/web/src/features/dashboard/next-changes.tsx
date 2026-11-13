import {
	type FlowMove,
	type MoveTone,
	moveStep,
	moveText,
	moveTone,
	moveToneLabel,
} from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon, HandIcon, WrenchIcon } from "lucide-react";
import { chatAboutMove } from "@/features/flows";
import { AgentButton } from "@/shared/agent-button";
import type { Project } from "@/shared/api";
import { formatCost, formatDuration } from "@/shared/format";

/** The most next changes the list shows. */
const MAX_MOVES = 4;

const TONE: Record<MoveTone, { icon: typeof HandIcon; className: string }> = {
	up: { icon: ArrowUpRightIcon, className: "text-status-finished" },
	fix: { icon: WrenchIcon, className: "text-status-failed" },
	hold: { icon: HandIcon, className: "text-status-waiting" },
};

const FORMAT = { cost: formatCost, time: formatDuration };

/**
 * The next changes to try, the most pressing first: what each asks you to
 * do, why, and an agent that reads the run that shows it and proposes the
 * change in the editor.
 */
export function NextChanges({
	project,
	flow,
	moves,
}: {
	project: Project;
	flow: string;
	moves: FlowMove[];
}) {
	if (moves.length === 0) {
		return (
			<p className="text-muted-foreground">Its runs show nothing to change.</p>
		);
	}
	return (
		<ItemGroup className="gap-2">
			{moves.slice(0, MAX_MOVES).map((move, index) => {
				const tone = moveTone(move);
				const { icon: Icon, className } = TONE[tone];
				const { title, why } = moveText(move, FORMAT);
				const step = moveStep(move);
				return (
					<Item key={`${move.kind}-${step ?? ""}`} size="sm" variant="outline">
						<ItemMedia variant="icon">
							<Icon
								className={cn("size-4", className)}
								aria-label={moveToneLabel(tone)}
							/>
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle>{title}</ItemTitle>
							<ItemDescription className="text-xs">{why}</ItemDescription>
						</ItemContent>
						<ItemActions>
							<AgentButton
								entry="flow.move"
								size="xs"
								variant={index === 0 ? "default" : "outline"}
								link={
									<Link
										to="/projects/$projectId/flows/$name"
										params={{ projectId: project.id, name: flow }}
										search={{
											chat: chatAboutMove({
												kind: move.kind,
												runId: move.runId,
												...(step ? { step } : {}),
											}),
										}}
									/>
								}
							/>
							<Button
								size="xs"
								variant="ghost"
								nativeButton={false}
								render={
									<Link to="/runs/$runId" params={{ runId: move.runId }} />
								}
							>
								Open the run
							</Button>
						</ItemActions>
					</Item>
				);
			})}
		</ItemGroup>
	);
}
