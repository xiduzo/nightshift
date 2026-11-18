import { Button } from "@nightshift/ui/components/button";
import { Kbd } from "@nightshift/ui/components/kbd";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@nightshift/ui/components/popover";
import { Separator } from "@nightshift/ui/components/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { LayoutGridIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FAMILY_TILE } from "../../canvas";
import { CATALOG, type CatalogEntry } from "./catalog";
import { dragEntry } from "./drag";
import { NodeGrid } from "./node-grid";
import { RECENT_MAX } from "./recent-nodes";
import type { NodeAdder } from "./use-node-adder";

/** One dock item and the gap after it, in pixels: `size-8` and `gap-1`. */
const ITEM_SLOT = 36;
/**
 * The room the dock leaves above and below it, in pixels: the flow's title
 * card sits above it. The dock is in the middle, so both sides count.
 */
const CLEARANCE = 96;

/**
 * One dock item, after the Magic UI Dock, in CSS only: the item you point at
 * grows most, its neighbours a little, the next ones a touch. The dock keeps
 * its width, so the bigger icons reach out over the canvas.
 */
const DOCK_ITEM = cn(
	"size-8 shrink-0 rounded-full bg-background p-0 dark:bg-background",
	"transition-[width,height] duration-200 ease-out motion-reduce:transition-none",
	"hover:size-12",
	"[&:has(+_*:hover)]:size-10 [*:hover+&]:size-10",
	"[&:has(+*+*:hover)]:size-9 [*:hover+*+&]:size-9",
);

/** How many recent nodes fit beside the canvas, `height` pixels high. */
function recentRoom(height: number): number {
	const room = height - 2 * CLEARANCE - ITEM_SLOT;
	return Math.max(0, Math.min(RECENT_MAX, Math.floor(room / ITEM_SLOT)));
}

/**
 * The node dock on the left edge of the canvas. Its first button opens the
 * node grid: every node and kit, by family, with a search. Below it, the
 * nodes added last, as many as the canvas has room for. The dock keeps its
 * size as nodes and kits grow. Click a node to add it, or drag it onto the
 * canvas to place it.
 */
export function NodeDock({
	adder,
	onDragChange,
	className,
}: {
	adder: NodeAdder;
	/** The entry being dragged, and null when the drag ends. */
	onDragChange: (entry: CatalogEntry | null) => void;
	className?: string;
}) {
	const dock = useRef<HTMLDivElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const [fits, setFits] = useState(RECENT_MAX);
	// The grid hides while a tile is dragged from it, so the canvas under it takes the drop.
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		const canvas = dock.current?.parentElement;
		if (!canvas) return;
		const observer = new ResizeObserver(() =>
			setFits(recentRoom(canvas.clientHeight)),
		);
		observer.observe(canvas);
		return () => observer.disconnect();
	}, []);

	const recent = adder.recent
		.slice(0, fits)
		.map((item) => CATALOG.find((entry) => entry.key === item))
		.filter((entry): entry is CatalogEntry => entry !== undefined);

	return (
		<div
			ref={dock}
			role="toolbar"
			aria-label="Nodes"
			aria-orientation="vertical"
			className={cn(
				"flex w-11 flex-col items-start gap-1 rounded-xl border bg-background/80 p-1.5 shadow-sm backdrop-blur-md",
				className,
			)}
		>
			<Popover
				open={adder.open}
				onOpenChange={(open) => (open ? adder.show() : adder.close())}
			>
				<Tooltip>
					<TooltipTrigger
						render={
							<PopoverTrigger
								render={
									<Button
										variant="outline"
										className={DOCK_ITEM}
										aria-label="All nodes"
									/>
								}
							/>
						}
					>
						<LayoutGridIcon className="size-[50%]" aria-hidden="true" />
					</TooltipTrigger>
					<TooltipContent side="right">
						All nodes <Kbd>Tab</Kbd>
					</TooltipContent>
				</Tooltip>
				<PopoverContent
					side="right"
					align="center"
					sideOffset={10}
					initialFocus={search}
					className={cn(
						"max-h-[calc(100svh-2rem)] w-[min(25rem,calc(100vw-5rem))] gap-0 overflow-hidden p-0",
						dragging && "pointer-events-none opacity-0",
					)}
				>
					<NodeGrid
						adder={adder}
						search={search}
						onDragChange={onDragChange}
						onDragging={setDragging}
					/>
				</PopoverContent>
			</Popover>
			{recent.length > 0 ? <Separator className="my-1" /> : null}
			{recent.map((entry) => {
				const Icon = entry.icon;
				return (
					<Tooltip key={entry.key}>
						<TooltipTrigger
							render={
								<Button
									variant="outline"
									{...dragEntry(entry, onDragChange)}
									onClick={() => adder.pick(entry)}
									className={cn(
										DOCK_ITEM,
										"cursor-grab active:cursor-grabbing",
										FAMILY_TILE[entry.family],
									)}
									aria-label={entry.label}
								/>
							}
						>
							<Icon className="size-[50%]" aria-hidden="true" />
						</TooltipTrigger>
						<TooltipContent side="right" className="max-w-60">
							<span className="flex flex-col gap-0.5">
								<span className="font-medium">{entry.label}</span>
								<span className="opacity-80">{entry.blurb}</span>
							</span>
						</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}
