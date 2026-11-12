import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { PinIcon, SkipForwardIcon, XIcon } from "lucide-react";
import { outcomeLabel } from "../../canvas/outcome-badge";
import { marksText } from "./marks";
import type { TestMarksApi } from "./use-test-marks";

/**
 * "2 pinned · 1 skipped" beside Run: the nodes a test run pins or skips.
 * Its menu selects one of them, or clears them all. Nothing shows without
 * a mark.
 */
export function TestBadge({
	test,
	onSelectNode,
}: {
	test: TestMarksApi;
	onSelectNode: (nodeId: string) => void;
}) {
	const { marks, count } = test;
	if (count.total === 0) return null;
	const text = marksText(count);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="secondary" size="sm" />}>
				<PinIcon data-icon="inline-start" />
				{text}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				{count.pinned > 0 ? (
					<DropdownMenuGroup>
						<DropdownMenuLabel>Pinned output</DropdownMenuLabel>
						{Object.keys(marks.pinned).map((nodeId) => (
							<DropdownMenuItem
								key={nodeId}
								onClick={() => onSelectNode(nodeId)}
							>
								<PinIcon aria-hidden="true" />
								<span className="truncate font-mono">{nodeId}</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				) : null}
				{count.skipped > 0 ? (
					<DropdownMenuGroup>
						<DropdownMenuLabel>Skipped</DropdownMenuLabel>
						{Object.entries(marks.skipped).map(([nodeId, outcome]) => (
							<DropdownMenuItem
								key={nodeId}
								onClick={() => onSelectNode(nodeId)}
							>
								<SkipForwardIcon aria-hidden="true" />
								<span className="truncate font-mono">{nodeId}</span>
								<span className="ml-auto shrink-0 text-muted-foreground text-xs">
									takes {outcomeLabel(outcome)}
								</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={test.clear}>
					<XIcon aria-hidden="true" />
					Clear pins and skips
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
