/**
 * The inspector of the selected Section: its name, colour and description,
 * its warnings, its nodes, and open and remove. Removing a Section keeps its
 * nodes. "Make subflow" moves them to a flow of their own (the dialog).
 */
import {
	type Flow,
	type FlowIssue,
	type FlowSection,
	nodesWithin,
	type SectionColor,
	sectionBoundary,
	sectionColors,
} from "@nightshift/flows";
import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { Textarea } from "@nightshift/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { cn } from "@nightshift/ui/lib/utils";
import {
	BanIcon,
	CheckIcon,
	GroupIcon,
	SquareFunctionIcon,
	Trash2Icon,
	TriangleAlertIcon,
	ZoomInIcon,
} from "lucide-react";
import { useId } from "react";
import { PanelHeader } from "@/shared/panel";
import { OUTCOME_COLOR_STYLE } from "../../canvas/outcome-badge";
import { Field, InspectorSection, Note } from "../fields";

/** No colour: the box takes a neutral grey. */
const NO_COLOR = "none";

export function SectionInspector({
	flow,
	section,
	issues,
	autoFocus = false,
	onChange,
	onOpen,
	onRemove,
	onSelectNode,
	onMakeSubflow,
}: {
	flow: Flow;
	section: FlowSection;
	/** The Section's validation warnings. */
	issues: readonly FlowIssue[];
	/** Puts the cursor in the name: the Section was just made. */
	autoFocus?: boolean;
	onChange: (change: (section: FlowSection) => FlowSection) => void;
	/** Shows only the Section's nodes on the canvas. */
	onOpen: () => void;
	onRemove: () => void;
	/** Selects one of its nodes on the canvas. */
	onSelectNode: (nodeId: string) => void;
	/** Opens "Make subflow from section". */
	onMakeSubflow: () => void;
}) {
	const id = useId();
	// With the nodes of the Sections inside it.
	const members = nodesWithin(flow, section);
	const { entry } = sectionBoundary(flow, members);
	const name = section.label.trim() || section.id;

	return (
		<div className="flex flex-col">
			<PanelHeader
				icon={GroupIcon}
				kicker="Section"
				title={name}
				mono={false}
				actions={
					<>
						<Button
							variant="outline"
							size="sm"
							onClick={onOpen}
							title="Show only its nodes"
						>
							<ZoomInIcon data-icon="inline-start" />
							Open
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							className="text-destructive hover:bg-destructive/10 hover:text-destructive"
							onClick={onRemove}
							aria-label="Remove section"
							title="Remove section. Its nodes stay."
						>
							<Trash2Icon />
						</Button>
					</>
				}
			/>

			{issues.length > 0 ? (
				<div className="px-4 pb-4">
					<Alert className="border-status-waiting/40 text-status-waiting">
						<TriangleAlertIcon />
						<AlertDescription>
							<ul className="flex flex-col gap-1">
								{issues.map((issue, index) => (
									// The same message can come twice.
									<li key={`${issue.message}:${index}`}>{issue.message}</li>
								))}
							</ul>
						</AlertDescription>
					</Alert>
				</div>
			) : null}

			<InspectorSection title="Section">
				<Field id={`${id}-label`} label="Name">
					<Input
						id={`${id}-label`}
						value={section.label}
						placeholder={section.id}
						autoComplete="off"
						autoFocus={autoFocus}
						onFocus={(event) => {
							if (autoFocus) event.currentTarget.select();
						}}
						onChange={(event) => {
							const label = event.target.value;
							onChange((current) => ({ ...current, label }));
						}}
					/>
				</Field>

				<Field id={`${id}-color`} label="Color">
					<ToggleGroup
						id={`${id}-color`}
						aria-label="Color"
						spacing={1}
						className="flex flex-wrap"
						value={[section.color ?? NO_COLOR]}
						onValueChange={(value) => {
							const picked = value[0];
							// Clicking the picked colour again keeps it.
							if (picked === undefined) return;
							onChange(({ color: _, ...current }) =>
								picked === NO_COLOR
									? current
									: { ...current, color: picked as SectionColor },
							);
						}}
					>
						<ToggleGroupItem
							value={NO_COLOR}
							size="sm"
							aria-label="No color"
							title="No color"
						>
							<span
								aria-hidden="true"
								className="flex size-5 items-center justify-center rounded-full border border-muted-foreground/50 border-dashed text-muted-foreground"
							>
								{section.color === undefined ? (
									<CheckIcon className="size-3.5" />
								) : (
									<BanIcon className="size-3" />
								)}
							</span>
						</ToggleGroupItem>
						{sectionColors.map((color) => (
							<ToggleGroupItem
								key={color}
								value={color}
								size="sm"
								aria-label={color}
								title={color}
							>
								<span
									aria-hidden="true"
									className="flex size-5 items-center justify-center rounded-full text-background"
									style={{ background: OUTCOME_COLOR_STYLE[color].color }}
								>
									{section.color === color ? (
										<CheckIcon className="size-3.5" />
									) : null}
								</span>
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</Field>

				<Field id={`${id}-description`} label="Description" optional>
					<Textarea
						id={`${id}-description`}
						value={section.description ?? ""}
						placeholder="What this part of the flow does"
						className="max-h-60"
						rows={2}
						onChange={(event) => {
							const description = event.target.value;
							onChange(({ description: _, ...current }) =>
								description ? { ...current, description } : current,
							);
						}}
					/>
				</Field>
			</InspectorSection>

			<InspectorSection
				title="Nodes"
				aside={
					<Badge variant="secondary" className="tabular-nums">
						{members.length}
					</Badge>
				}
			>
				<div className="flex flex-wrap gap-1.5">
					{members.map((node) => (
						<Button
							key={node}
							variant="outline"
							size="xs"
							className={cn("font-mono", node === entry && "border-primary/50")}
							onClick={() => onSelectNode(node)}
							title={`Select ${node}`}
						>
							{node}
						</Button>
					))}
				</div>
				<Note>
					{entry
						? `The flow comes into this Section at ${entry}.`
						: "The flow has no single way into this Section."}{" "}
					Remove the Section to keep its nodes on their own.
				</Note>
			</InspectorSection>

			<InspectorSection
				title="Subflow"
				description="Move these nodes to a new flow. A Subflow runs it here in their place. You see each change before it happens."
			>
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					onClick={onMakeSubflow}
				>
					<SquareFunctionIcon data-icon="inline-start" />
					Make subflow
				</Button>
			</InspectorSection>
		</div>
	);
}
