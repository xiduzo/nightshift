import { gateParts, waitedText } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Separator } from "@nightshift/ui/components/separator";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	HistoryIcon,
	HourglassIcon,
	LoaderIcon,
	LockIcon,
} from "lucide-react";
import { useId } from "react";
import type { OpenGate } from "@/shared/api";
import { InlineMarkdown } from "@/shared/markdown";
import { LocalTime } from "@/shared/time";
import { URGENCY_LABEL, UrgencyMarker } from "@/shared/urgency";
import { AskAttachments } from "../ask-attachments";
import { AskForm } from "../ask-form";
import { GateChoiceForm } from "../gate-choice-form";
import { GateLinkItem } from "../gate-link-item";
import { ContextList } from "../gate-question";
import { WrittenByModel } from "../written-by-model";
import { GateHandover } from "./gate-handover";
import { GateFrom } from "./gate-where";

/**
 * One open Gate in the inbox pane, as a handover. On the left: who asks,
 * the title, then why you decide, what is done and what the flow
 * recommends, then the question's details and the links to check. On the
 * right, in place while you read: your answer. A Gate of any of your
 * Spaces is answered here. An Ask shows its files with the details, and
 * its form as the answer.
 */
export function GateDetail({ gate, now }: { gate: OpenGate; now: number }) {
	const answerId = useId();
	const { headline, context, links } = gateParts(gate.question);
	const urgencyByModel = gate.brief.byModel.includes("urgency");

	return (
		<div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-8 pb-16 md:px-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
			<article className="flex min-w-0 flex-col gap-8">
				<header className="flex min-w-0 flex-col gap-2">
					<GateFrom gate={gate} />
					<h1 className="whitespace-pre-wrap text-balance break-words font-semibold text-xl leading-snug tracking-tight">
						<InlineMarkdown text={headline} />
					</h1>
					<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
						<Badge variant="outline">
							<UrgencyMarker urgency={gate.urgency} />
							{URGENCY_LABEL[gate.urgency]}
						</Badge>
						<Badge
							variant="outline"
							className="border-status-waiting/40 bg-status-waiting/10 text-status-waiting"
						>
							<HourglassIcon aria-hidden="true" />
							waiting{" "}
							<LocalTime at={gate.openedAt} className="tabular-nums">
								{waitedText(now - gate.openedAt)}
							</LocalTime>
						</Badge>
						{urgencyByModel ? (
							<WrittenByModel>Urgency set by Night Shift</WrittenByModel>
						) : null}
					</div>
				</header>
				<GateHandover brief={gate.brief} />
				{context.length > 0 || gate.form?.attachments ? (
					<section className="flex min-w-0 flex-col gap-3">
						<Separator />
						<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							Details
						</h2>
						{context.length > 0 ? <ContextList items={context} plain /> : null}
						{gate.form?.attachments ? (
							<AskAttachments
								runId={gate.runId}
								attachments={gate.form.attachments}
								filesHere={gate.walker.thisDevice}
							/>
						) : null}
					</section>
				) : null}
				<section className="flex flex-col gap-2">
					<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Check first
					</h2>
					{links.length > 0 ? (
						// A long list scrolls: the rest of the page stays in view.
						<ScrollArea className="max-h-80 [&>[data-slot=scroll-area-viewport]]:max-h-80">
							{/* Room for the scrollbar once the list scrolls (more than four). */}
							<ItemGroup className={cn("gap-2", links.length > 4 && "pr-3")}>
								{links.map((link) => (
									<GateLinkItem key={link.url} link={link} />
								))}
							</ItemGroup>
						</ScrollArea>
					) : null}
					<ItemGroup className="gap-2">
						<Item
							variant="outline"
							size="sm"
							render={<Link to="/runs/$runId" params={{ runId: gate.runId }} />}
						>
							<ItemMedia variant="icon">
								<HistoryIcon />
							</ItemMedia>
							<ItemContent className="min-w-0">
								<ItemTitle>Open the run</ItemTitle>
								<ItemDescription className="truncate text-xs">
									Its steps, outputs and transcript
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<ChevronRightIcon
									className="size-3.5 text-muted-foreground"
									aria-hidden="true"
								/>
							</ItemActions>
						</Item>
					</ItemGroup>
				</section>
			</article>
			<aside className="flex flex-col gap-4 lg:sticky lg:top-8 lg:self-start">
				<Card size="sm">
					<CardHeader>
						<CardTitle id={answerId}>Your answer</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{gate.canAnswer && gate.branchesWork ? (
							<Alert>
								<LoaderIcon />
								<AlertTitle>The run is still busy</AlertTitle>
								<AlertDescription>
									Another branch of this run still works. You can send your
									answer when its step ends.
								</AlertDescription>
							</Alert>
						) : null}
						{gate.canAnswer && gate.form ? (
							<AskForm
								runId={gate.runId}
								stepId={gate.stepId}
								form={gate.form}
								deadline={gate.deadline}
								runTitle={gate.runTitle}
								filesHere={gate.walker.thisDevice}
								held={gate.branchesWork}
							/>
						) : gate.canAnswer ? (
							<GateChoiceForm gate={gate} labelledBy={answerId} />
						) : (
							<Alert>
								<LockIcon />
								<AlertTitle>You can read this Gate only</AlertTitle>
								<AlertDescription>
									Your role in {gate.spaceName} does not let you answer Gates.
									Ask an owner or admin of the Space to answer it, or to give
									you another role.
								</AlertDescription>
							</Alert>
						)}
					</CardContent>
				</Card>
			</aside>
		</div>
	);
}
