import { type NodeSample, pinProblem } from "@nightshift/client";
import {
	type Flow,
	type FlowNode,
	standInOutcomes,
	standsIn,
} from "@nightshift/flows";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@nightshift/ui/components/context-menu";
import { PinIcon, PinOffIcon, SkipForwardIcon } from "lucide-react";
import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useRef,
	useState,
} from "react";
import { outcomeLabel } from "../../canvas/outcome-badge";
import { markOf } from "./marks";
import type { TestMarksApi } from "./use-test-marks";

/** The node of the flow under `target` on the canvas, by its id. */
function nodeUnder(target: EventTarget | null, flow: Flow): FlowNode | null {
	if (!(target instanceof Element)) return null;
	const id = target.closest(".react-flow__node")?.getAttribute("data-id");
	// A Section box is a canvas node too, but no node of the flow.
	return flow.nodes.find((node) => node.id === id) ?? null;
}

/** Opens the menu at the middle of a node: for the keyboard. */
function openAt(element: Element) {
	const box = element.getBoundingClientRect();
	element.dispatchEvent(
		new globalThis.MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			clientX: box.left + box.width / 2,
			clientY: box.top + box.height / 2,
		}),
	);
}

/**
 * The menu of a node on the canvas: pin its output or skip it in a test
 * run. One menu for the whole canvas. A right-click on a node opens it,
 * and so do Shift+F10 and the menu key on a focused node. A right-click
 * anywhere else keeps the browser's own menu.
 */
export function NodeMenu({
	flow,
	samples,
	test,
	children,
}: {
	flow: Flow;
	/** What each node gave in the runs the canvas shows. */
	samples: ReadonlyMap<string, NodeSample> | null | undefined;
	test: TestMarksApi;
	children: ReactNode;
}) {
	// The node stays while the menu closes, so its items do not vanish first.
	const [menu, setMenu] = useState<{ open: boolean; nodeId: string | null }>({
		open: false,
		nodeId: null,
	});
	// The node a right-click found, until the menu asks to open.
	const found = useRef<string | null>(null);
	const node = flow.nodes.find((candidate) => candidate.id === menu.nodeId);

	const onContextMenuCapture = (event: MouseEvent) => {
		const under = nodeUnder(event.target, flow);
		if (under === null) {
			// Not on a node: the menu stays shut.
			found.current = null;
			event.stopPropagation();
			return;
		}
		found.current = under.id;
		// A menu key that the browser turns into a right-click without a
		// place: open it at the node instead.
		if (event.clientX === 0 && event.clientY === 0) {
			event.preventDefault();
			event.stopPropagation();
			const element = (event.target as Element).closest(".react-flow__node");
			if (element) openAt(element);
		}
	};
	const onKeyDown = (event: KeyboardEvent) => {
		const menuKey =
			event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
		if (!menuKey || !(event.target instanceof Element)) return;
		const element = event.target.closest(".react-flow__node");
		if (!element || nodeUnder(element, flow) === null) return;
		event.preventDefault();
		openAt(element);
	};

	return (
		<ContextMenu
			open={menu.open && node !== undefined}
			onOpenChange={(open) => {
				if (!open) {
					setMenu((current) => ({ ...current, open: false }));
					return;
				}
				// Only a right-click on a node opens it, not a long press elsewhere.
				const nodeId = found.current;
				found.current = null;
				if (nodeId !== null) setMenu({ open: true, nodeId });
			}}
		>
			<ContextMenuTrigger
				className="h-full w-full"
				onContextMenuCapture={onContextMenuCapture}
				onKeyDown={onKeyDown}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent className="w-60">
				{node ? (
					<NodeMenuItems
						node={node}
						sample={samples?.get(node.id)}
						test={test}
					/>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}

function NodeMenuItems({
	node,
	sample,
	test,
}: {
	node: FlowNode;
	sample: NodeSample | undefined;
	test: TestMarksApi;
}) {
	const mark = markOf(test.marks, node.id);
	const outcomes = standInOutcomes(node);
	const problem = pinProblem(node, sample);
	return (
		<>
			<ContextMenuGroup>
				<ContextMenuLabel className="truncate font-mono">
					{node.id}
				</ContextMenuLabel>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			{!standsIn(node) ? (
				<ContextMenuGroup>
					<ContextMenuLabel className="font-normal">
						A test run always runs this node.
					</ContextMenuLabel>
				</ContextMenuGroup>
			) : (
				<ContextMenuGroup>
					{mark?.kind === "pinned" ? (
						<ContextMenuItem onClick={() => test.unmark(node.id)}>
							<PinOffIcon aria-hidden="true" />
							Unpin output
						</ContextMenuItem>
					) : (
						<ContextMenuItem
							disabled={problem !== null}
							onClick={() => {
								if (sample)
									test.pin(node.id, {
										runId: sample.runId,
										stepId: sample.stepId,
									});
							}}
						>
							<PinIcon aria-hidden="true" />
							<span className="flex flex-col">
								Pin output
								{problem ? (
									<span className="text-muted-foreground text-xs">
										{problem}
									</span>
								) : null}
							</span>
						</ContextMenuItem>
					)}
					<ContextMenuSub>
						<ContextMenuSubTrigger disabled={outcomes.length === 0}>
							<SkipForwardIcon aria-hidden="true" />
							Skip with outcome
						</ContextMenuSubTrigger>
						<ContextMenuSubContent className="w-48">
							<ContextMenuRadioGroup
								value={mark?.kind === "skipped" ? mark.outcome : ""}
								onValueChange={(outcome: string) => test.skip(node.id, outcome)}
							>
								{outcomes.map((outcome) => (
									<ContextMenuRadioItem
										key={outcome}
										value={outcome}
										className="font-mono"
									>
										{outcomeLabel(outcome)}
									</ContextMenuRadioItem>
								))}
							</ContextMenuRadioGroup>
						</ContextMenuSubContent>
					</ContextMenuSub>
					{mark?.kind === "skipped" ? (
						<ContextMenuItem onClick={() => test.unmark(node.id)}>
							<SkipForwardIcon aria-hidden="true" />
							Stop skipping
						</ContextMenuItem>
					) : null}
				</ContextMenuGroup>
			)}
		</>
	);
}
