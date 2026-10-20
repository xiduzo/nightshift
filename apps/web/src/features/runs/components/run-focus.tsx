import { Badge } from "@nightshift/ui/components/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@nightshift/ui/components/breadcrumb";
import { Button } from "@nightshift/ui/components/button";
import { ChevronRightIcon, XIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { RunDetail, StepSummary } from "@/shared/api";

import {
	calledFlowName,
	type ItemScope,
	itemsOf,
	scopeChain,
} from "../lib/run-steps";

/*
 * The call in focus on the run page: the breadcrumb over the graph, the chip
 * above the step list, and the calls a step ran under.
 */

/** One crumb per call, from the run's flow down to the call in focus. */
function useCrumbs(
	run: RunDetail,
	steps: StepSummary[],
	focus: ItemScope,
): { key: string; label: ReactNode; scope: ItemScope }[] {
	const crumbs: { key: string; label: ReactNode; scope: ItemScope }[] = [
		{
			key: "top",
			label: <span className="font-mono">{run.flowName ?? "Run"}</span>,
			scope: null,
		},
	];
	for (const { parentStep, itemId } of scopeChain(steps, focus)) {
		const called = calledFlowName(run, steps, parentStep);
		const item =
			itemId === null
				? undefined
				: itemsOf(parentStep, steps).find((one) => one.id === itemId);
		crumbs.push({
			key: `${parentStep.id}:${itemId ?? ""}`,
			label: (
				<>
					<span className="font-mono text-muted-foreground">
						{parentStep.nodeId} ·
					</span>{" "}
					{itemId === null ? (
						<span className="font-mono">{called ?? "called flow"}</span>
					) : (
						<>
							{item?.title ?? itemId}
							{called ? (
								<span className="font-mono text-muted-foreground">
									{" "}
									· {called}
								</span>
							) : null}
						</>
					)}
				</>
			),
			scope: { parentStepId: parentStep.id, itemId },
		});
	}
	return crumbs;
}

/** Over the graph: where the called flow sits, with a way back up. */
export function FocusBreadcrumb({
	run,
	steps,
	focus,
	onSelect,
}: {
	run: RunDetail;
	steps: StepSummary[];
	focus: ItemScope;
	onSelect: (scope: ItemScope) => void;
}) {
	const crumbs = useCrumbs(run, steps, focus);
	return (
		<Breadcrumb aria-label="Where in the run" className="min-w-0">
			<BreadcrumbList className="flex-nowrap gap-1 text-xs sm:gap-1.5">
				{crumbs.map((crumb, index) => (
					<Fragment key={crumb.key}>
						{index > 0 ? <BreadcrumbSeparator /> : null}
						<BreadcrumbItem
							className={index === crumbs.length - 1 ? "min-w-0" : "shrink-0"}
						>
							{index === crumbs.length - 1 ? (
								<BreadcrumbPage
									aria-current="location"
									className="truncate font-normal"
								>
									{crumb.label}
								</BreadcrumbPage>
							) : (
								<BreadcrumbLink
									render={
										<button
											type="button"
											className="rounded-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
											onClick={() => onSelect(crumb.scope)}
										/>
									}
								>
									{crumb.label}
								</BreadcrumbLink>
							)}
						</BreadcrumbItem>
					</Fragment>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

/** Above the step list: which call it shows, and a way back to the whole run. */
export function FocusChip({
	steps,
	focus,
	onClear,
}: {
	steps: StepSummary[];
	focus: NonNullable<ItemScope>;
	onClear: () => void;
}) {
	const parentStep = steps.find((step) => step.id === focus.parentStepId);
	const item =
		parentStep && focus.itemId !== null
			? itemsOf(parentStep, steps).find((one) => one.id === focus.itemId)
			: undefined;
	return (
		<Badge variant="outline" className="h-6 min-w-0 max-w-56 gap-1 pr-0.5">
			<span className="min-w-0 truncate">
				{focus.itemId === null
					? `${parentStep?.nodeId ?? "call"}`
					: (item?.title ?? focus.itemId)}
			</span>
			<Button
				variant="ghost"
				size="icon-xs"
				className="size-5 rounded-full"
				onClick={onClear}
				aria-label="Show all"
				title="Show all"
			>
				<XIcon />
			</Button>
		</Badge>
	);
}

/** For a step in a called flow: the calls it ran under. Clicking one focuses it. */
export function StepContext({
	run,
	steps,
	step,
	onSelect,
}: {
	run: RunDetail;
	steps: StepSummary[];
	step: StepSummary;
	onSelect: (scope: ItemScope) => void;
}) {
	const crumbs = useCrumbs(run, steps, step.scope).slice(1);
	return (
		<div className="flex min-w-0 items-baseline gap-1.5">
			<span className="shrink-0">In</span>
			<Breadcrumb
				aria-label="The calls this step ran under"
				className="min-w-0"
			>
				<BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
					{crumbs.map((crumb, index) => (
						<BreadcrumbItem key={crumb.key} className="min-w-0">
							{index > 0 ? (
								<ChevronRightIcon
									className="size-3.5 shrink-0"
									aria-hidden="true"
								/>
							) : null}
							<BreadcrumbLink
								render={
									<button
										type="button"
										title="Focus on this call"
										className="min-w-0 truncate rounded-sm text-left text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
										onClick={() => onSelect(crumb.scope)}
									/>
								}
							>
								{crumb.label}
							</BreadcrumbLink>
						</BreadcrumbItem>
					))}
				</BreadcrumbList>
			</Breadcrumb>
		</div>
	);
}
