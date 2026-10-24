import type { FlowCheck, FlowIssue } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemContent,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@nightshift/ui/components/popover";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { cn } from "@nightshift/ui/lib/utils";
import {
	ChevronDownIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
} from "lucide-react";

/**
 * The validator's findings, as one button over the canvas that shows the
 * counts. It opens the list, errors first; a click on an issue selects its
 * node or edge.
 */
export function IssuesPopover({
	check,
	onSelect,
	className,
}: {
	check: FlowCheck;
	onSelect: (issue: FlowIssue) => void;
	className?: string;
}) {
	const errors = check.issues.filter((issue) => issue.severity === "error");
	const warnings = check.issues.filter((issue) => issue.severity === "warning");
	// Errors first, each group in the validator's order.
	const sorted = [...errors, ...warnings];

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className={cn(
							"gap-1.5 bg-background shadow-sm dark:bg-background",
							className,
						)}
					/>
				}
			>
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
							{warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
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
				{sorted.length > 0 ? <ChevronDownIcon data-icon="inline-end" /> : null}
			</PopoverTrigger>
			<PopoverContent className="w-96 gap-0 p-0">
				<ScrollArea className="max-h-80 [&>[data-slot=scroll-area-viewport]]:max-h-80">
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
			</PopoverContent>
		</Popover>
	);
}
