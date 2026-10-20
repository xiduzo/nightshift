import type { Flow } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { Input } from "@nightshift/ui/components/input";
import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { BracesIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";

import { type TemplateVariable, templateVariables } from "../flow-draft";

import { Field, Note, Optional } from "./fields";
import { useProjectFlowMap } from "./project-flows-context";

/**
 * A text field that takes `{{name.path}}` templates, with the variables it
 * can use below it: the flow's inputs, other nodes' outputs, and `run`.
 * Clicking one inserts it at the cursor. A JSON value (an Agent's `data`, a
 * Call's `results`, a JSON input) leaves the cursor before the closing
 * braces, ready for a path: `{{planner.data.tasks}}`.
 */
export function TemplateField({
	id,
	label,
	hint,
	flow,
	nodeId,
	value,
	onChange,
	placeholder,
	invalid,
	className,
	multiline = true,
	variablesOpen = true,
	scopes,
	required,
}: {
	id: string;
	label: ReactNode;
	hint?: ReactNode;
	flow: Flow;
	/** The node the field belongs to: its own outputs are left out. Null for the flow's outputs. */
	nodeId: string | null;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	invalid?: boolean;
	className?: string;
	/** False: a one-line input, for a binding or a list source. */
	multiline?: boolean;
	/** Whether the variable list starts open. */
	variablesOpen?: boolean;
	/** Only these groups of variables (`inputs`, `run`, …). Default: all. */
	scopes?: readonly string[];
	required?: boolean;
}) {
	const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

	const insert = (variable: TemplateVariable) => {
		const field = ref.current;
		const start = field?.selectionStart ?? value.length;
		const end = field?.selectionEnd ?? value.length;
		onChange(value.slice(0, start) + variable.text + value.slice(end));
		requestAnimationFrame(() => {
			if (!field) return;
			field.focus();
			// A JSON value: the cursor waits before `}}` for a `.path`.
			const cursor = start + variable.text.length - (variable.json ? 2 : 0);
			field.setSelectionRange(cursor, cursor);
		});
	};

	const describedBy = hint ? `${id}-hint` : undefined;

	return (
		<div className="flex flex-col gap-2">
			<Field
				id={id}
				label={
					required ? (
						<>
							{label}
							<Optional>required</Optional>
						</>
					) : (
						label
					)
				}
				hint={hint}
			>
				{multiline ? (
					<Textarea
						ref={ref}
						id={id}
						value={value}
						placeholder={placeholder}
						className={cn(
							"max-h-80 min-h-28 font-mono text-xs leading-relaxed",
							className,
						)}
						aria-invalid={invalid}
						aria-required={required}
						aria-describedby={describedBy}
						onChange={(event) => onChange(event.target.value)}
					/>
				) : (
					<Input
						ref={ref}
						id={id}
						value={value}
						placeholder={placeholder}
						className={cn("font-mono text-xs", className)}
						autoComplete="off"
						spellCheck={false}
						aria-invalid={invalid}
						aria-required={required}
						aria-describedby={describedBy}
						onChange={(event) => onChange(event.target.value)}
					/>
				)}
			</Field>
			<TemplateVariables
				flow={flow}
				nodeId={nodeId}
				scopes={scopes}
				open={variablesOpen}
				onInsert={insert}
			/>
		</div>
	);
}

/** The variables a field can use, grouped by name; a click inserts one. */
export function TemplateVariables({
	flow,
	nodeId,
	scopes,
	open,
	onInsert,
}: {
	flow: Flow;
	nodeId: string | null;
	/** Only these groups. Default: all. */
	scopes?: readonly string[];
	/** Whether the list starts open. */
	open: boolean;
	onInsert: (variable: TemplateVariable) => void;
}) {
	const flows = useProjectFlowMap();
	const groups = templateVariables(flow, nodeId, flows).filter(
		(group) => scopes === undefined || scopes.includes(group.scope),
	);

	return (
		<Collapsible defaultOpen={open} className="rounded-lg border border-dashed">
			<CollapsibleTrigger
				render={
					<Button
						variant="ghost"
						size="xs"
						className="group/vars h-7 w-full justify-start rounded-[inherit] font-normal text-muted-foreground"
					/>
				}
			>
				<ChevronRightIcon
					className="transition-transform group-data-panel-open/vars:rotate-90 motion-reduce:transition-none"
					aria-hidden="true"
				/>
				<BracesIcon aria-hidden="true" />
				Template variables · click to insert
			</CollapsibleTrigger>
			<CollapsibleContent className="flex flex-col gap-3 border-t border-dashed px-2.5 py-2.5">
				<dl className="flex flex-col gap-2.5">
					{groups.map(({ scope, variables }) => (
						<div key={scope} className="flex flex-col gap-1.5">
							<dt className="font-mono text-[11px] text-muted-foreground">
								{scope}
							</dt>
							<dd className="flex flex-wrap gap-1">
								{variables.map((variable) => (
									<Button
										key={variable.text}
										variant="outline"
										size="xs"
										className="h-6 px-1.5 font-mono font-normal text-[11px]"
										onClick={() => onInsert(variable)}
										title={[
											`Insert ${variable.text}`,
											variable.json
												? `Holds JSON: add a path, for example ${variable.text.slice(0, -2)}.name}}`
												: null,
											variable.description ?? null,
										]
											.filter(Boolean)
											.join("\n")}
									>
										{variable.label}
										{variable.json ? (
											<span className="text-muted-foreground">.…</span>
										) : null}
									</Button>
								))}
							</dd>
						</div>
					))}
				</dl>
				<Note>
					A value marked <code>.…</code> holds JSON: add a path, such as{" "}
					<code>{"{{planner.data.tasks}}"}</code> or{" "}
					<code>{"{{item.title}}"}</code>. A node that has not run yet gives an
					empty value.
				</Note>
			</CollapsibleContent>
		</Collapsible>
	);
}
