import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { useMemo, useState } from "react";

import type { RunDetail, StepSummary } from "@/lib/api-types";
import { formatDateTime, formatTime } from "@/lib/format";
import {
	previewValue,
	scopeLabel,
	type VariableChange,
	type VariableGroup,
	type VariableRow,
	variableGroups,
} from "@/lib/run-variables";

import { JsonBlock } from "./json-block";

const TYPE_LABEL = {
	text: "text",
	number: "number",
	boolean: "yes or no",
	json: "JSON",
} as const;

/**
 * The run's variables: per flow it ran, each variable's value now and the
 * step that set it. A variable opens every value it had. Shown only when
 * the run has variables.
 */
export function RunVariables({
	run,
	steps,
	onShowStep,
}: {
	run: RunDetail;
	steps: StepSummary[];
	onShowStep: (stepId: string) => void;
}) {
	const groups = useMemo(() => variableGroups(run, steps), [run, steps]);
	/** The open variable: its group's key and its name. */
	const [open, setOpen] = useState<{ key: string; name: string } | null>(null);
	if (groups.length === 0) return null;
	const openGroup = open
		? groups.find((group) => group.key === open.key)
		: undefined;
	const openRow = openGroup?.rows.find((row) => row.name === open?.name);

	const showStep = (stepId: string) => {
		setOpen(null);
		onShowStep(stepId);
	};

	return (
		<Card className="shrink-0 gap-3 py-4">
			<CardHeader className="px-4">
				<CardTitle>Variables</CardTitle>
				<CardDescription>
					Values the flow keeps while it runs, and the step that set each one.
				</CardDescription>
			</CardHeader>
			<CardContent className="px-4">
				<ScrollArea className="max-h-64 [&>[data-slot=scroll-area-viewport]]:max-h-64">
					<div className="flex flex-col gap-4">
						{groups.map((group) => (
							<VariableTable
								key={group.key}
								run={run}
								steps={steps}
								group={group}
								titled={groups.length > 1}
								onOpen={(name) => setOpen({ key: group.key, name })}
								onShowStep={onShowStep}
							/>
						))}
					</div>
				</ScrollArea>
			</CardContent>
			<Sheet
				open={openRow !== undefined}
				onOpenChange={(next) => {
					if (!next) setOpen(null);
				}}
			>
				<SheetContent>
					{openRow ? (
						<VariableHistory
							row={openRow}
							steps={steps}
							onShowStep={showStep}
						/>
					) : null}
				</SheetContent>
			</Sheet>
		</Card>
	);
}

/** The variables of one flow the run ran. With more than one, it names the flow. */
function VariableTable({
	run,
	steps,
	group,
	titled,
	onOpen,
	onShowStep,
}: {
	run: RunDetail;
	steps: StepSummary[];
	group: VariableGroup;
	titled: boolean;
	onOpen: (name: string) => void;
	onShowStep: (stepId: string) => void;
}) {
	const title = group.scope ? (
		<ScopeTitle run={run} steps={steps} scope={group.scope} />
	) : (
		<span className="font-mono">{run.flowName ?? "This run"}</span>
	);
	return (
		<section className="flex flex-col gap-1.5">
			{titled ? (
				<h3 className="text-muted-foreground text-xs">{title}</h3>
			) : null}
			<Table className="text-xs">
				<TableHeader>
					<TableRow>
						<TableHead>Variable</TableHead>
						<TableHead>Value</TableHead>
						<TableHead>Set by</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{group.rows.map((row) => (
						<TableRow key={row.name}>
							<TableCell className="whitespace-nowrap">
								<div className="flex items-center gap-1.5">
									<Button
										variant="link"
										size="xs"
										className="h-auto px-0 font-mono"
										title="Show every value"
										onClick={() => onOpen(row.name)}
									>
										{row.name}
									</Button>
									{row.type ? (
										<Badge variant="outline">{TYPE_LABEL[row.type]}</Badge>
									) : null}
								</div>
							</TableCell>
							<TableCell className="max-w-64 truncate font-mono">
								<ValuePreview value={row.last.value} />
							</TableCell>
							<TableCell className="whitespace-nowrap">
								<SetBy
									change={row.last}
									steps={steps}
									onShowStep={onShowStep}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
}

/** A called flow's name: its Call step's node, the item, and the flow. */
function ScopeTitle({
	run,
	steps,
	scope,
}: {
	run: RunDetail;
	steps: StepSummary[];
	scope: NonNullable<VariableGroup["scope"]>;
}) {
	const label = scopeLabel(run, steps, scope);
	return (
		<>
			<span className="font-mono">{label.nodeId}</span>
			{label.item ? <> · {label.item}</> : null}
			{label.flow ? <span className="font-mono"> · {label.flow}</span> : null}
		</>
	);
}

function ValuePreview({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">No value</span>;
	}
	return <span title={previewValue(value, 400)}>{previewValue(value)}</span>;
}

/** The step a change came from, with a way to show it; "Start value" for the first value. */
function SetBy({
	change,
	steps,
	onShowStep,
}: {
	change: VariableChange;
	steps: StepSummary[];
	onShowStep: (stepId: string) => void;
}) {
	if (change.stepId === null) {
		return <span className="text-muted-foreground">Start value</span>;
	}
	const stepId = change.stepId;
	const step = steps.find((one) => one.id === stepId);
	return (
		<Button
			variant="link"
			size="xs"
			className="h-auto px-0"
			title="Show this step"
			onClick={() => onShowStep(stepId)}
		>
			<span className="font-mono">{step?.nodeId ?? "step"}</span>
			{step && step.visit > 1 ? (
				<span className="text-muted-foreground">visit {step.visit}</span>
			) : null}
		</Button>
	);
}

/** Every value one variable had, oldest first, with the step that set it and when. */
function VariableHistory({
	row,
	steps,
	onShowStep,
}: {
	row: VariableRow;
	steps: StepSummary[];
	onShowStep: (stepId: string) => void;
}) {
	return (
		<>
			<SheetHeader>
				<SheetTitle className="font-mono">{row.name}</SheetTitle>
				<SheetDescription>
					{row.description ??
						"Every value this variable had in the run, oldest first."}
				</SheetDescription>
			</SheetHeader>
			<ScrollArea className="min-h-0 flex-1">
				<ItemGroup className="gap-2 px-4 pb-6">
					{row.history.map((change, index) => (
						<Item
							// A step can write the same variable once only; the start value has no step.
							key={`${change.stepId ?? "start"}-${index}`}
							variant="outline"
							size="sm"
						>
							<ItemContent className="min-w-0 gap-2">
								<div className="flex items-center justify-between gap-2">
									<ItemTitle>
										<SetBy
											change={change}
											steps={steps}
											onShowStep={onShowStep}
										/>
									</ItemTitle>
									<ItemDescription>
										<time
											dateTime={new Date(change.at).toISOString()}
											title={formatDateTime(change.at)}
										>
											{formatTime(change.at)}
										</time>
									</ItemDescription>
								</div>
								{change.value === null ? (
									<span className="text-muted-foreground text-xs">
										No value
									</span>
								) : (
									<JsonBlock value={change.value} />
								)}
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			</ScrollArea>
		</>
	);
}
