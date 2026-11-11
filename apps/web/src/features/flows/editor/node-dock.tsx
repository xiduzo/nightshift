import { NODE_FAMILIES, NODE_FAMILY, type NodeFamily } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { type PaletteItem, paletteMeta } from "../canvas/node-type";

/**
 * Every palette item. A Decision shows twice, as the words people look
 * for: a Gate (you decide) and a Branch (a rule decides). A Decision by a
 * model is the same node, set in the inspector.
 */
const ITEMS: PaletteItem[] = [
	"agent",
	"command",
	"tool",
	"gate",
	"branch",
	"value",
	"since-last-run",
	"wait",
	"lease",
	"service",
	"call",
	"join",
	"end",
];

/** The family of a palette item: a Gate and a Branch are Decisions. */
function familyOf(item: PaletteItem): NodeFamily {
	return item === "gate" || item === "branch"
		? NODE_FAMILY.decision
		: NODE_FAMILY[item];
}

/** The items by family (`NODE_FAMILIES`): do, decide, shape, hold, compose. */
const PALETTE: PaletteItem[] = NODE_FAMILIES.flatMap((family) =>
	ITEMS.filter((item) => familyOf(item) === family),
);

/** The drag data of a palette item on its way from the dock to the canvas. */
export const NODE_DRAG_TYPE = "application/x-nightshift-node";

export function isPaletteItem(value: string): value is PaletteItem {
	return (PALETTE as string[]).includes(value);
}

/**
 * One dock item, after the Magic UI Dock, in CSS only: the item you point at
 * grows most, its neighbours a little, the next ones a touch. The dock keeps
 * its width, so the bigger icons reach out over the canvas.
 */
const DOCK_ITEM = cn(
	"size-8 shrink-0 cursor-grab rounded-full bg-background p-0 active:cursor-grabbing dark:bg-background",
	"transition-[width,height] duration-200 ease-out motion-reduce:transition-none",
	"hover:size-12",
	"[&:has(+_*:hover)]:size-10 [*:hover+&]:size-10",
	"[&:has(+*+*:hover)]:size-9 [*:hover+*+&]:size-9",
);

/**
 * The node types, as a dock on the left edge of the canvas. Drag one onto
 * the canvas to place it, or click it to add it in the middle.
 */
export function NodeDock({
	onAdd,
	onDragChange,
	className,
}: {
	onAdd: (type: PaletteItem) => void;
	/** The item being dragged, and null when the drag ends. */
	onDragChange: (type: PaletteItem | null) => void;
	className?: string;
}) {
	return (
		<div
			role="toolbar"
			aria-label="Add a node"
			aria-orientation="vertical"
			className={cn(
				"flex w-11 flex-col items-start gap-1.5 rounded-xl border bg-background/80 p-1.5 shadow-sm backdrop-blur-md",
				className,
			)}
		>
			{PALETTE.map((type) => {
				const { label, icon: Icon, blurb } = paletteMeta(type);
				return (
					<Tooltip key={type}>
						<TooltipTrigger
							render={
								<Button
									variant="outline"
									draggable
									onDragStart={(event) => {
										event.dataTransfer.setData(NODE_DRAG_TYPE, type);
										event.dataTransfer.effectAllowed = "move";
										onDragChange(type);
									}}
									onDragEnd={() => onDragChange(null)}
									onClick={() => onAdd(type)}
									className={DOCK_ITEM}
									aria-label={label}
								/>
							}
						>
							<Icon className="size-[50%]" aria-hidden="true" />
						</TooltipTrigger>
						<TooltipContent side="right" className="max-w-60">
							<span className="flex flex-col gap-0.5">
								<span className="font-medium">{label}</span>
								<span className="opacity-80">{blurb}</span>
							</span>
						</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}
