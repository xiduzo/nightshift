import type { FlowIssue } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	Item,
	ItemContent,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { cn } from "@nightshift/ui/lib/utils";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";

import type { FlowCheck } from "@/lib/flow-draft";

/**
 * The validator's findings under the canvas, errors first. A Collapsible
 * whose header always shows the counts; a click on an issue selects its node
 * or edge.
 */
export function IssuesPanel({
	check,
	onSelect,
	defaultOpen = true,
	className,
}: {
	check: FlowCheck;
	onSelect: (issue: FlowIssue) => void;
	/** Whether the list starts open when there are issues. */
	defaultOpen?: boolean;
	className?: string;
}) {
	const errors = check.issues.filter((issue) => issue.severity === "error");
	const warnings = check.issues.filter((issue) => issue.severity === "warning");
	// Errors first, each group in the validator's order.
	const sorted = [...errors, ...warnings];
	const [open, setOpen] = useState(defaultOpen && sorted.length > 0);

	return (
		<Card size="sm" className={cn("shrink-0 gap-0 py-0", className)}>
			<Collapsible
				open={open}
				onOpenChange={setOpen}
				render={<section aria-labelledby="issues-heading" />}
			>
				<h2 id="issues-heading">
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								className="group/issues h-11 w-full justify-start gap-2 rounded-none px-3"
							/>
						}
					>
						<ChevronRightIcon
							className="size-3.5 text-muted-foreground transition-transform group-data-panel-open/issues:rotate-90 motion-reduce:transition-none"
							aria-hidden="true"
						/>
						<span className="font-medium text-sm">Issues</span>
						<span aria-live="polite" className="flex items-center gap-1.5">
							{errors.length > 0 ? (
								<Badge variant="destructive" className="tabular-nums">
									<CircleAlertIcon aria-hidden="true" />
									{errors.length} {errors.length === 1 ? "error" : "errors"}
								</Badge>
							) : null}
							{warnings.length > 0 ? (
								<Badge
									variant="outline"
									className="border-status-waiting/40 bg-status-waiting/10 text-status-waiting tabular-nums"
								>
									<TriangleAlertIcon aria-hidden="true" />
									{warnings.length}{" "}
									{warnings.length === 1 ? "warning" : "warnings"}
								</Badge>
							) : null}
							{sorted.length === 0 ? (
								<Badge
									variant="outline"
									className="border-status-finished/40 bg-status-finished/10 text-status-finished"
								>
									<CircleCheckIcon aria-hidden="true" />
									No issues
								</Badge>
							) : null}
						</span>
					</CollapsibleTrigger>
				</h2>
				<CollapsibleContent className="border-t">
					<ScrollArea className="max-h-44 [&>[data-slot=scroll-area-viewport]]:max-h-44">
						<div className="flex flex-col gap-1 p-1.5">
							{check.validatorError ? (
								<p className="flex items-start gap-2 px-2 py-1.5 text-muted-foreground text-xs">
									<InfoIcon
										className="mt-px size-3.5 shrink-0"
										aria-hidden="true"
									/>
									Some checks could not run, so this list may be incomplete:{" "}
									{check.validatorError}
								</p>
							) : null}
							{sorted.length === 0 ? (
								<p className="flex items-center gap-2 px-2 py-1.5 text-status-finished text-xs">
									<CircleCheckIcon className="size-3.5" aria-hidden="true" />
									No issues. Save the flow, then run it.
								</p>
							) : (
								<ul className="flex flex-col gap-0.5">
									{sorted.map((issue, index) => {
										const target = issue.nodeId ?? issue.edgeId;
										const isError = issue.severity === "error";
										const Icon = isError ? CircleAlertIcon : TriangleAlertIcon;
										return (
											<li
												key={`${issue.severity}:${target ?? ""}:${issue.message}:${index}`}
											>
												<Item
													size="xs"
													render={
														<button
															type="button"
															disabled={!target}
															onClick={() => onSelect(issue)}
														/>
													}
													className="flex-nowrap items-start py-1.5 text-left hover:bg-muted disabled:hover:bg-transparent"
												>
													<ItemMedia
														variant="icon"
														className={cn(
															"translate-y-px",
															isError
																? "text-destructive"
																: "text-status-waiting",
														)}
													>
														<Icon
															className="size-3.5"
															aria-label={issue.severity}
														/>
													</ItemMedia>
													<ItemContent className="min-w-0">
														<ItemTitle className="line-clamp-none block w-full font-normal text-xs leading-relaxed">
															{target ? (
																<span className="mr-1.5 font-mono text-muted-foreground">
																	{issue.nodeId ?? `edge ${issue.edgeId}`}
																</span>
															) : null}
															{issue.message}
														</ItemTitle>
													</ItemContent>
												</Item>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</ScrollArea>
				</CollapsibleContent>
			</Collapsible>
		</Card>
	);
}
