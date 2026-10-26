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
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	CheckIcon,
	EyeIcon,
	EyeOffIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/shared/markdown";
import type { ChatProposal } from "./chat-thread";
import type { ProposalCanvas } from "./proposal-canvas";
import { summaryLabels } from "./proposal-canvas";

/**
 * A new version of the flow the agent proposes: what it changes, the
 * issues it still has, and the person's choice. Apply asks first when the
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
		<Card size="sm" className="gap-3">
			<CardHeader>
				<CardTitle>Proposed change</CardTitle>
				<CardDescription>
					<Markdown text={summary} className="text-sm" />
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div className="flex flex-wrap gap-1.5">
					{/* The counts compare with the draft as it is now: only while the choice is open. */}
					{!open ? null : labels.length > 0 ? (
						labels.map((label) => (
							<Badge key={label} variant="outline">
								{label}
							</Badge>
						))
					) : (
						<Badge variant="outline">Only node positions change</Badge>
					)}
					{proposal.status === "applied" ? (
						<Badge variant="secondary">
							<CheckIcon aria-hidden="true" />
							Applied
						</Badge>
					) : proposal.status === "discarded" ? (
						<Badge variant="secondary">Discarded</Badge>
					) : null}
				</div>
				{open && issues.length > 0 ? (
					<Alert variant={errors.length > 0 ? "destructive" : "default"}>
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
			</CardContent>
			{open ? (
				<CardFooter className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
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
					<Button
						size="sm"
						onClick={() => (stale ? setConfirming(true) : onApply())}
					>
						Apply
					</Button>
					<Button variant="ghost" size="sm" onClick={onDiscard}>
						Discard
					</Button>
				</CardFooter>
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
		</Card>
	);
}
