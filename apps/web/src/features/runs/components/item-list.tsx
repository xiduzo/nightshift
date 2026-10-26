import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import {
	ArrowUpRightIcon,
	GitBranchIcon,
	ListIcon,
	ScanSearchIcon,
} from "lucide-react";

import { ItemStateBadge } from "@/features/flows";
import type { ItemState, ItemSummary, StepSummary } from "@/shared/api";
import { JsonDetails } from "@/shared/code";
import { formatTime } from "@/shared/format";
import { useOpenedStep } from "../hooks/use-opened-step";
import { type ItemScope, itemsOf, scopeKey } from "../lib/run-steps";
import { Elapsed } from "./elapsed";

/**
 * The elements of one Call step with `each`, in the order they started: state, id
 * and title (linked when the element has a `url`), its branch and base, how
 * long it took, why it failed, is blocked, or halted, and the element itself
 * as JSON. Focusing one narrows the steps and the graph to it.
 */
export function ItemList({
	runId,
	step: summary,
	steps,
	selectedItem,
	onSelectItem,
}: {
	runId: string;
	step: StepSummary;
	steps: StepSummary[];
	selectedItem: ItemScope;
	onSelectItem: (scope: ItemScope) => void;
}) {
	// The elements load when the step opens.
	const step = useOpenedStep(runId, summary);
	const items = itemsOf(step, steps);
	const counts = new Map<ItemState, number>();
	for (const item of items) {
		counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
	}

	if (items.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ListIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No items yet</EmptyTitle>
					<EmptyDescription>
						They show here once the call starts them.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<section
			aria-labelledby={`items-${step.id}`}
			className="flex flex-col gap-3 p-4"
		>
			<header className="flex flex-wrap items-center gap-2">
				<h3 id={`items-${step.id}`} className="font-medium text-sm">
					{items.length} {items.length === 1 ? "item" : "items"}
				</h3>
				{[...counts].map(([state, count]) => (
					<span
						key={state}
						className="flex items-center gap-1 text-muted-foreground text-xs tabular-nums"
					>
						<ItemStateBadge state={state} />
						{count}
					</span>
				))}
			</header>
			<ItemGroup className="gap-2">
				{items.map((item) => {
					const scope = { parentStepId: step.id, itemId: item.id };
					return (
						<ItemRow
							key={item.id}
							item={item}
							selected={scopeKey(selectedItem) === scopeKey(scope)}
							onFocus={() =>
								onSelectItem(
									scopeKey(selectedItem) === scopeKey(scope) ? null : scope,
								)
							}
						/>
					);
				})}
			</ItemGroup>
		</section>
	);
}

function ItemRow({
	item,
	selected,
	onFocus,
}: {
	item: ItemSummary;
	selected: boolean;
	onFocus: () => void;
}) {
	const label = item.id;
	const showId = item.title !== item.id;
	const focusLabel = selected
		? "Show the whole run again"
		: `Focus on ${label}: its steps and the flow it ran`;
	return (
		<Item
			variant="outline"
			size="sm"
			className={cn("items-start", selected && "border-ring/40 bg-muted")}
		>
			<ItemContent className="min-w-0 gap-1.5">
				<ItemTitle className="w-full min-w-0 text-xs">
					<ItemStateBadge state={item.state} />
					{showId ? (
						<span className="max-w-[40%] shrink-0 truncate font-mono font-normal text-muted-foreground">
							{label}
						</span>
					) : null}
					{item.url ? (
						<a
							href={item.url}
							target="_blank"
							rel="noreferrer"
							className="flex min-w-0 items-center gap-1 rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
							title={`Open ${item.url}`}
						>
							<span className="truncate">{item.title}</span>
							<ArrowUpRightIcon
								className="size-3 shrink-0 text-muted-foreground"
								aria-hidden="true"
							/>
						</a>
					) : (
						<span className="truncate">{item.title}</span>
					)}
				</ItemTitle>
				{item.branch ? (
					<ItemDescription className="flex min-w-0 items-center gap-1 text-xs">
						<GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
						<span className="truncate font-mono text-foreground/80">
							{item.branch}
						</span>
						{item.baseBranch ? (
							<>
								<span aria-hidden="true">→</span>
								<span className="sr-only">on top of</span>
								<span className="truncate font-mono">{item.baseBranch}</span>
							</>
						) : null}
					</ItemDescription>
				) : null}
				{item.reason ? (
					<ItemDescription className="line-clamp-none whitespace-pre-wrap break-words text-xs">
						{item.reason}
					</ItemDescription>
				) : null}
				{item.value !== null && item.value !== undefined ? (
					<JsonDetails summary="Item (JSON)" value={item.value} />
				) : null}
			</ItemContent>
			<ItemActions className="gap-1">
				<span
					className="text-muted-foreground text-xs tabular-nums"
					title={`Started ${formatTime(item.startedAt)}`}
				>
					<Elapsed start={item.startedAt} end={item.endedAt ?? null} />
				</span>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant={selected ? "secondary" : "ghost"}
								size="icon-sm"
								onClick={onFocus}
								aria-pressed={selected}
								aria-label={focusLabel}
							/>
						}
					>
						<ScanSearchIcon aria-hidden="true" />
					</TooltipTrigger>
					<TooltipContent>
						{selected
							? "Show the whole run again"
							: "Show only this item: its steps and the flow it ran"}
					</TooltipContent>
				</Tooltip>
			</ItemActions>
		</Item>
	);
}
