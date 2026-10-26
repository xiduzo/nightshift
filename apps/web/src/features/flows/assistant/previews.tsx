/** What a suggestion would change, shown before the person applies it. */
import {
	type FlowInputDef,
	type FlowVariableDef,
	type NamedChange,
	type NodeOption,
	type OutcomeChange,
	type OutputFieldChange,
	outputChanges,
	type SuggestionChange,
	type VariableWrite,
	type WriteChange,
} from "@nightshift/flows";
import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { cn } from "@nightshift/ui/lib/utils";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { lineDiff, templateParts } from "./line-diff";

const CHANGE_BADGE: Record<
	Exclude<SuggestionChange, "same">,
	{ label: string; variant: "default" | "outline" | "destructive" }
> = {
	new: { label: "New", variant: "default" },
	changed: { label: "Changed", variant: "outline" },
	removed: { label: "Removed", variant: "destructive" },
};

function ChangeBadge({ change }: { change: SuggestionChange }) {
	if (change === "same") {
		return <span className="text-muted-foreground text-xs">Same</span>;
	}
	const { label, variant } = CHANGE_BADGE[change];
	return <Badge variant={variant}>{label}</Badge>;
}

/** A line of a prompt, its `{{references}}` set apart as the field shows them. */
function TemplateLine({ text }: { text: string }) {
	return (
		<>
			{templateParts(text).map((part, index) =>
				part.ref ? (
					<span
						// The parts of one line do not move.
						key={index}
						className="rounded-sm bg-primary/10 font-medium text-primary"
					>
						{part.text}
					</span>
				) : (
					<span key={index}>{part.text}</span>
				),
			)}
		</>
	);
}

/** The prompt before and after, line by line: removed lines struck out, added ones marked. */
export function PromptPreview({
	before,
	after,
	part,
}: {
	before: string;
	after: string;
	/** True: `before` is the selected part, not the whole prompt. */
	part: boolean;
}) {
	return (
		<TextPreview
			label={part ? "The selected part becomes" : "The prompt becomes"}
			before={before}
			after={after}
		/>
	);
}

/**
 * A text field before and after, line by line: removed lines struck out,
 * added ones marked, `{{references}}` set apart.
 */
export function TextPreview({
	label,
	before,
	after,
}: {
	/** "The command becomes". */
	label: string;
	before: string;
	after: string;
}) {
	const lines = lineDiff(before, after);
	return (
		<div className="flex flex-col gap-1.5">
			<p className="font-medium text-xs">{label}</p>
			<pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 py-1.5 font-mono text-xs leading-relaxed">
				{lines.map((line, index) => (
					<div
						// A diff line has no id; its place is its identity.
						key={index}
						className={cn(
							"whitespace-pre-wrap break-words px-2",
							line.kind === "added" && "bg-status-finished/10 text-foreground",
							line.kind === "removed" &&
								"bg-destructive/10 text-muted-foreground line-through",
						)}
					>
						<span
							aria-hidden="true"
							className="mr-2 select-none text-muted-foreground"
						>
							{line.kind === "added"
								? "+"
								: line.kind === "removed"
									? "−"
									: " "}
						</span>
						<span className="sr-only">
							{line.kind === "added"
								? "Added: "
								: line.kind === "removed"
									? "Removed: "
									: ""}
						</span>
						<TemplateLine text={line.text} />
					</div>
				))}
			</pre>
		</div>
	);
}

/** The output fields a suggestion gives, against the ones the node has now. */
export function OutputPreview({
	before,
	after,
}: {
	before: Record<string, unknown> | undefined;
	after: Record<string, unknown>;
}) {
	const fields = outputChanges(before, after);
	if (fields.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				No fields: the data is a {String(after.type ?? "value")}. Apply to see
				it under JSON.
			</p>
		);
	}
	return (
		<ItemGroup className="gap-1">
			{fields.map((field) => (
				<FieldRow key={`${field.change}-${field.name}`} field={field} />
			))}
		</ItemGroup>
	);
}

function FieldRow({ field }: { field: OutputFieldChange }) {
	return (
		<Item
			variant="outline"
			size="xs"
			className={cn(field.change === "removed" && "opacity-70")}
		>
			<ItemContent className="min-w-0">
				<ItemTitle
					className={cn(
						"font-mono text-xs",
						field.change === "removed" && "line-through",
					)}
				>
					{field.name}
					<span className="font-normal font-sans text-muted-foreground">
						{field.type}
						{field.required ? "" : ", optional"}
					</span>
				</ItemTitle>
				{field.description ? (
					<ItemDescription className="text-xs">
						{field.description}
					</ItemDescription>
				) : null}
			</ItemContent>
			<ItemActions>
				<ChangeBadge change={field.change} />
			</ItemActions>
		</Item>
	);
}

function writeText(write: VariableWrite): string {
	return write.expression !== undefined
		? write.expression
		: (write.value ?? "");
}

/** The variable writes a suggestion gives, and the variables the flow must add for them. */
export function SetPreview({
	writes,
	variables,
}: {
	writes: readonly WriteChange[];
	/** The variables the flow does not declare yet. */
	variables: readonly FlowVariableDef[];
}) {
	return (
		<div className="flex flex-col gap-3">
			{writes.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					This step sets no variables.
				</p>
			) : (
				<ItemGroup className="gap-1">
					{writes.map(({ write, change }, index) => (
						<Item
							// Writes have no ids; the row follows its place in the list.
							key={index}
							variant="outline"
							size="xs"
							className={cn(change === "removed" && "opacity-70")}
						>
							<ItemContent className="min-w-0">
								<ItemTitle
									className={cn(
										"font-mono text-xs",
										change === "removed" && "line-through",
									)}
								>
									{write.variable}
									{write.on && write.on.length > 0 ? (
										<span className="font-normal font-sans text-muted-foreground">
											on {write.on.join(", ")}
										</span>
									) : null}
								</ItemTitle>
								<ItemDescription className="break-all font-mono text-xs">
									{write.expression !== undefined ? (
										writeText(write)
									) : (
										<TemplateLine text={writeText(write)} />
									)}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<ChangeBadge change={change} />
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			)}
			{variables.length > 0 ? (
				<div className="flex flex-col gap-1.5">
					<p className="font-medium text-xs">The flow gets these variables</p>
					<ItemGroup className="gap-1">
						{variables.map((variable) => (
							<Item key={variable.name} variant="outline" size="xs">
								<ItemContent className="min-w-0">
									<ItemTitle className="font-mono text-xs">
										{variable.name}
										<span className="font-normal font-sans text-muted-foreground">
											{variable.type}
										</span>
									</ItemTitle>
									{variable.description ? (
										<ItemDescription className="text-xs">
											{variable.description}
										</ItemDescription>
									) : null}
								</ItemContent>
								<ItemActions>
									<ChangeBadge change="new" />
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				</div>
			) : null}
		</div>
	);
}

/** One row of a list preview: what the item is, and how it compares with what the flow has now. */
type ChangeRow = {
	key: string;
	title: string;
	/** Beside the title, in muted text: a type, or the name it had. */
	meta?: string;
	description?: ReactNode;
	/** The description is code, such as a rule or a template. */
	code?: boolean;
	change: SuggestionChange;
};

/** A list preview: a row per item, removed ones struck out. */
function ChangeList({
	rows,
	empty,
}: {
	rows: readonly ChangeRow[];
	empty: string;
}) {
	if (rows.length === 0) {
		return <p className="text-muted-foreground text-xs">{empty}</p>;
	}
	return (
		<ItemGroup className="gap-1">
			{rows.map((row) => (
				<Item
					key={`${row.change}-${row.key}`}
					variant="outline"
					size="xs"
					className={cn(row.change === "removed" && "opacity-70")}
				>
					<ItemContent className="min-w-0">
						<ItemTitle
							className={cn(
								"font-mono text-xs",
								row.change === "removed" && "line-through",
							)}
						>
							{row.title}
							{row.meta ? (
								<span className="font-normal font-sans text-muted-foreground">
									{row.meta}
								</span>
							) : null}
						</ItemTitle>
						{row.description ? (
							<ItemDescription
								className={cn("text-xs", row.code && "break-all font-mono")}
							>
								{row.description}
							</ItemDescription>
						) : null}
					</ItemContent>
					<ItemActions>
						<ChangeBadge change={row.change} />
					</ItemActions>
				</Item>
			))}
		</ItemGroup>
	);
}

/** The outcomes or options a suggestion gives, and the edges that go with the removed ones. */
export function OutcomesPreview({
	outcomes,
	droppedEdges,
	noun,
}: {
	outcomes: readonly OutcomeChange[];
	droppedEdges: number;
	/** "outcome" or "option". */
	noun: string;
}) {
	return (
		<div className="flex flex-col gap-3">
			<ChangeList
				empty={`No ${noun}s.`}
				rows={outcomes.map(({ outcome, change, from }) => ({
					key: outcome.name,
					title: outcome.name,
					meta: from ? `was ${from}` : undefined,
					description: outcome.description,
					change,
				}))}
			/>
			{droppedEdges > 0 ? (
				<Alert>
					<CircleAlertIcon />
					<AlertDescription>
						{droppedEdges === 1
							? `Apply removes 1 edge of a removed ${noun}.`
							: `Apply removes ${droppedEdges} edges of the removed ${noun}s.`}{" "}
						Undo brings them back.
					</AlertDescription>
				</Alert>
			) : null}
		</div>
	);
}

/** The options of a Decision with the rules a suggestion gives. */
export function RulesPreview({
	rows,
}: {
	rows: readonly NamedChange<NodeOption>[];
}) {
	return (
		<ChangeList
			empty="This node has no options."
			rows={rows.map(({ name, item, change }) => ({
				key: name,
				title: name,
				description: item.when ?? "Picked when no rule holds.",
				code: item.when !== undefined,
				change,
			}))}
		/>
	);
}

/** The arguments a suggestion gives a tool call. */
export function ArgumentsPreview({
	rows,
}: {
	rows: readonly NamedChange<[string, string]>[];
}) {
	return (
		<ChangeList
			empty="The call takes no arguments."
			rows={rows.map(({ name, item, change }) => ({
				key: name,
				title: name,
				description: <TemplateLine text={item[1]} />,
				code: true,
				change,
			}))}
		/>
	);
}

/** The inputs a suggestion gives the flow. */
export function InputsPreview({
	rows,
}: {
	rows: readonly NamedChange<FlowInputDef>[];
}) {
	return (
		<ChangeList
			empty="The flow takes no inputs."
			rows={rows.map(({ name, item, change }) => ({
				key: name,
				title: name,
				meta: `${item.type}${item.required ? ", required" : ""}`,
				description: item.description,
				change,
			}))}
		/>
	);
}
