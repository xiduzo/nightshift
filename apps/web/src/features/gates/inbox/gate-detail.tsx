import { gateParts, waitedText } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
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
	HandIcon,
	HistoryIcon,
	HourglassIcon,
	LoaderIcon,
	LockIcon,
} from "lucide-react";
import { useId } from "react";
import type { OpenGate } from "@/shared/api";
import { InlineMarkdown } from "@/shared/markdown";
import { LocalTime } from "@/shared/time";
import { AskAttachments } from "../ask-attachments";
import { AskForm } from "../ask-form";
import { GateChoiceForm } from "../gate-choice-form";
import { GateLinkItem } from "../gate-link-item";
import { ContextList } from "../gate-question";
import { GateWhere } from "./gate-where";

/**
 * One open Gate in the inbox pane. What happened on the left; the links to
 * check and the answer on the right, in place while you read. A Gate of
 * any of your Spaces is answered here, and its run opens from here. An
 * Ask shows its files with what happened, and its form as the answer.
 */
export function GateDetail({ gate, now }: { gate: OpenGate; now: number }) {
	const answerId = useId();
	const { headline, context, links } = gateParts(gate.question);

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-8 pb-16 md:px-8">
			<header className="flex items-start gap-4">
				<div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-status-waiting/10 text-status-waiting [&_svg]:size-5">
					<HandIcon aria-hidden="true" />
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<GateWhere gate={gate} />
					<h1 className="whitespace-pre-wrap text-balance break-words font-semibold text-xl leading-snug tracking-tight">
						<InlineMarkdown text={headline} />
					</h1>
					<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
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
						<span>
							{gate.flowName ? (
								<>
									Flow <span className="font-mono">{gate.flowName}</span>
								</>
							) : (
								"Quick run"
							)}
						</span>
						<span>
							{gate.form ? "Ask" : "Gate"}{" "}
							<span className="font-mono">{gate.nodeId}</span>
						</span>
					</div>
				</div>
			</header>
			<Separator />
			<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<section className="flex min-w-0 flex-col gap-3">
					<h2 className="font-medium text-sm">What happened</h2>
					{context.length > 0 ? (
						<ContextList items={context} plain />
					) : gate.form?.attachments ? null : (
						<p className="text-muted-foreground text-sm">
							The Gate asks only its question.
						</p>
					)}
					{gate.form?.attachments ? (
						<AskAttachments
							runId={gate.runId}
							attachments={gate.form.attachments}
							filesHere={gate.walker.thisDevice}
						/>
					) : null}
				</section>
				<aside className="flex flex-col gap-6 lg:sticky lg:top-8 lg:self-start">
					<section className="flex flex-col gap-2">
						<h2 className="font-medium text-sm">Check first</h2>
						{links.length > 0 ? (
							// A long list scrolls: the answer stays in view.
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
								render={
									<Link to="/runs/$runId" params={{ runId: gate.runId }} />
								}
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
					<Separator />
					<section className="flex flex-col gap-3">
						<h2 id={answerId} className="font-medium text-sm">
							Your answer
						</h2>
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
					</section>
				</aside>
			</div>
		</div>
	);
}
