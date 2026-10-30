import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	CheckIcon,
	EyeIcon,
	EyeOffIcon,
	TriangleAlertIcon,
	WorkflowIcon,
} from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/shared/markdown";
import type { ChatProposal } from "./chat-thread";
import type { ProposalCanvas } from "./proposal-canvas";
import { summaryLabels } from "./proposal-canvas";

/**
 * A new version of the flow the agent proposes, as an AI Elements
 * Confirmation: what it changes, the issues it still has, and the
 * person's choice. Apply asks first when the
 * draft changed since the agent got it: the proposal does not hold those
 * changes.
 */
export function ProposalCard({
	proposal,
	canvas,
	shown,
	stale,
	onToggleShown,
	onApply,
	onDiscard,
}: {
	proposal: ChatProposal;
	/** The proposal against the draft as it is now. */
	canvas: ProposalCanvas;
	/** The canvas shows this proposal now. */
	shown: boolean;
	/** The draft changed since the agent got it. */
	stale: boolean;
	onToggleShown: () => void;
	onApply: () => void;
	onDiscard: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const { summary, issues } = proposal.proposal;
	const labels = summaryLabels(canvas.summary);
	const errors = issues.filter((issue) => issue.severity === "error");
	const open = proposal.status === "open";

	return (
		<Item variant="outline" size="sm" className="items-start">
			<ItemMedia variant="icon">
				<WorkflowIcon />
			</ItemMedia>
			<ItemContent className="min-w-0 gap-2">
				<ItemTitle>
					{open ? "Apply this change to the flow?" : "Proposed change"}
					{proposal.status === "applied" ? (
						<Badge variant="secondary">
							<CheckIcon aria-hidden="true" />
							Applied
						</Badge>
					) : proposal.status === "discarded" ? (
						<Badge variant="secondary">Discarded</Badge>
					) : null}
				</ItemTitle>
				<Markdown text={summary} className="text-muted-foreground text-sm" />
				{/* The counts compare with the draft as it is now: only while the choice is open. */}
				{open ? (
					<div className="flex flex-wrap gap-1.5">
						{labels.length > 0 ? (
							labels.map((label) => (
								<Badge key={label} variant="outline">
									{label}
								</Badge>
							))
						) : (
							<Badge variant="outline">Only node positions change</Badge>
						)}
					</div>
				) : null}
			</ItemContent>
			{open && issues.length > 0 ? (
				<Alert
					variant={errors.length > 0 ? "destructive" : "default"}
					className="basis-full"
				>
					<TriangleAlertIcon aria-hidden="true" />
					<AlertTitle>
						{errors.length > 0
							? "This change has errors. Fix them before you run the flow."
							: "Check these points after you apply the change."}
					</AlertTitle>
					<AlertDescription>
						<ul className="flex list-disc flex-col gap-0.5 pl-4">
							{issues.map((issue) => (
								<li key={`${issue.nodeId ?? ""}:${issue.message}`}>
									{issue.nodeId ? (
										<span className="font-mono">{issue.nodeId}: </span>
									) : null}
									{issue.message}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : null}
			{open ? (
				<ItemActions className="basis-full flex-wrap">
					<Button
						variant="ghost"
						size="sm"
						className="mr-auto"
						aria-pressed={shown}
						onClick={onToggleShown}
					>
						{shown ? (
							<EyeOffIcon data-icon="inline-start" />
						) : (
							<EyeIcon data-icon="inline-start" />
						)}
						{shown ? "Show my flow" : "Show on canvas"}
					</Button>
					<Button variant="outline" size="sm" onClick={onDiscard}>
						Discard
					</Button>
					<Button
						size="sm"
						onClick={() => (stale ? setConfirming(true) : onApply())}
					>
						Apply
					</Button>
				</ItemActions>
			) : null}
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Apply over your new changes?</AlertDialogTitle>
						<AlertDialogDescription>
							You changed the flow after you sent the message. The proposed
							change does not include those changes. Apply replaces them.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								setConfirming(false);
								onApply();
							}}
						>
							Apply anyway
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Item>
	);
}
