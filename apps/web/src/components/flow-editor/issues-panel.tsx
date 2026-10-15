import type { FlowIssue } from "@nightshift/flows";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
} from "lucide-react";

import type { FlowCheck } from "@/lib/flow-draft";

export function IssuesPanel({
	check,
	onSelect,
}: {
	check: FlowCheck;
	onSelect: (issue: FlowIssue) => void;
}) {
	const errors = check.issues.filter((issue) => issue.severity === "error");
	const warnings = check.issues.filter((issue) => issue.severity === "warning");
	// Errors first, each group in the validator's order.
	const sorted = [...errors, ...warnings];

	return (
		<section
			aria-labelledby="issues-heading"
			className="flex min-h-0 flex-col border-t"
		>
			<header className="flex items-center gap-2 px-3 py-2">
				<h2 id="issues-heading" className="font-medium text-xs">
					Issues
				</h2>
				<span aria-live="polite" className="text-muted-foreground text-xs">
					{errors.length} {errors.length === 1 ? "error" : "errors"},{" "}
					{warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
				</span>
			</header>
			<div className="min-h-0 overflow-y-auto">
				{check.validatorError ? (
					<p className="flex items-start gap-1.5 px-3 pb-2 text-muted-foreground text-xs">
						<InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
						Only the schema was checked. The validator is not available:{" "}
						{check.validatorError}
					</p>
				) : null}
				{sorted.length === 0 ? (
					<p className="flex items-center gap-1.5 px-3 pb-3 text-status-finished text-xs">
						<CircleCheckIcon className="size-3.5" aria-hidden="true" />
						No issues. Save the flow, then run it.
					</p>
				) : (
					<ul className="flex flex-col pb-1">
						{sorted.map((issue, index) => {
							const target = issue.nodeId ?? issue.edgeId;
							const Icon =
								issue.severity === "error"
									? CircleAlertIcon
									: TriangleAlertIcon;
							return (
								<li
									key={`${issue.severity}:${target ?? ""}:${issue.message}:${index}`}
								>
									<button
										type="button"
										disabled={!target}
										onClick={() => onSelect(issue)}
										className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
									>
										<Icon
											className={cn(
												"mt-px size-3.5 shrink-0",
												issue.severity === "error"
													? "text-destructive"
													: "text-status-interrupted",
											)}
											aria-label={issue.severity}
										/>
										<span className="min-w-0 flex-1">
											{target ? (
												<span className="mr-1.5 font-mono text-muted-foreground">
													{issue.nodeId ?? `edge ${issue.edgeId}`}
												</span>
											) : null}
											{issue.message}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</section>
	);
}
