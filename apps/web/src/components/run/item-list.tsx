import { cn } from "@nightshift/ui/lib/utils";
import { ArrowUpRightIcon, GitBranchIcon, ScanSearchIcon } from "lucide-react";

import { ItemStateBadge } from "@/components/outcome-badge";
import { useNow } from "@/hooks/use-now";
import type { ItemSummary, StepSummary } from "@/lib/api-types";
import { formatDuration, formatTime, itemLabel } from "@/lib/format";
import { type ItemScope, itemsOf, scopeKey } from "@/lib/run-steps";

/**
 * The items of one For Each step, in the order they started: state, the
 * issue it builds (linked), its branch and base, how long it took, and why it
 * failed, is blocked, or halted. Focusing an item narrows the steps and the
 * graph to it.
 */
export function ItemList({
	step,
	steps,
	selectedItem,
	onSelectItem,
}: {
	step: StepSummary;
	steps: StepSummary[];
	selectedItem: ItemScope;
	onSelectItem: (scope: ItemScope) => void;
}) {
	const now = useNow(1000);
	const items = itemsOf(step, steps);
	const counts = new Map<string, number>();
	for (const item of items) {
		counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
	}

	return (
		<section
			aria-labelledby={`items-${step.id}`}
			className="flex min-h-0 flex-col border-b"
		>
			<header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs">
				<h3 id={`items-${step.id}`} className="font-medium">
					Items
				</h3>
				<span className="text-muted-foreground">
					{items.length === 0
						? "None started yet"
						: [...counts]
								.map(([state, count]) => `${count} ${state}`)
								.join(" · ")}
				</span>
			</header>
			{items.length > 0 ? (
				<ol className="max-h-56 divide-y overflow-y-auto border-t">
					{items.map((item) => {
						const scope = { forEachStepId: step.id, itemId: item.id };
						return (
							<li key={item.id}>
								<ItemRow
									item={item}
									now={now}
									selected={scopeKey(selectedItem) === scopeKey(scope)}
									onFocus={() =>
										onSelectItem(
											scopeKey(selectedItem) === scopeKey(scope) ? null : scope,
										)
									}
								/>
							</li>
						);
					})}
				</ol>
			) : null}
		</section>
	);
}

function ItemRow({
	item,
	now,
	selected,
	onFocus,
}: {
	item: ItemSummary;
	now: number;
	selected: boolean;
	onFocus: () => void;
}) {
	const label = itemLabel(item.id, item.number);
	return (
		<div
			className={cn(
				"grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5 px-4 py-1.5 text-xs",
				selected && "bg-muted",
			)}
		>
			<ItemStateBadge state={item.state} className="mt-px" />
			<div className="flex min-w-0 flex-col gap-0.5">
				<p className="flex min-w-0 items-center gap-1.5">
					{item.url ? (
						<a
							href={item.url}
							target="_blank"
							rel="noreferrer"
							className="flex min-w-0 items-center gap-1 underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
							title={`Open ${label} on GitHub`}
						>
							<span className="shrink-0 font-mono text-muted-foreground">
								{label}
							</span>
							<span className="truncate">{item.title}</span>
							<ArrowUpRightIcon
								className="size-3 shrink-0 text-muted-foreground"
								aria-hidden="true"
							/>
						</a>
					) : (
						<>
							<span className="shrink-0 font-mono text-muted-foreground">
								{label}
							</span>
							<span className="truncate">{item.title}</span>
						</>
					)}
				</p>
				{item.branch ? (
					<p className="flex min-w-0 items-center gap-1 text-muted-foreground">
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
					</p>
				) : null}
				{item.reason ? (
					<p className="whitespace-pre-wrap break-words text-muted-foreground">
						{item.reason}
					</p>
				) : null}
			</div>
			<div className="flex items-center gap-1">
				<span
					className="text-muted-foreground tabular-nums"
					title={`Started ${formatTime(item.startedAt)}`}
				>
					{formatDuration((item.endedAt ?? now) - item.startedAt)}
				</span>
				<button
					type="button"
					onClick={onFocus}
					aria-pressed={selected}
					aria-label={
						selected
							? "Show the whole run again"
							: `Focus on ${label}: its steps and its body flow`
					}
					title={
						selected
							? "Show the whole run again"
							: "Focus on this item: its steps and its body flow"
					}
					className={cn(
						"flex size-6 items-center justify-center text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
						selected && "bg-background text-foreground ring-1 ring-ring",
					)}
				>
					<ScanSearchIcon className="size-3.5" aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}
