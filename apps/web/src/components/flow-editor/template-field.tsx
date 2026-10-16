import type { Flow } from "@nightshift/flows";
import { Input } from "@nightshift/ui/components/input";
import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { type ReactNode, useRef } from "react";

import { type TemplateVariable, templateVariables } from "@/lib/flow-draft";

import { Field } from "./fields";
import { useProjectFlowMap } from "./project-flows-context";

/**
 * A text field that takes `{{name.path}}` templates, with the variables it
 * can use below it: the flow's inputs, other nodes' outputs, and `run`.
 * Clicking one inserts it at the cursor. A JSON value (an Agent's `data`, a
 * For Each's `results`, a JSON input) leaves the cursor before the closing
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
		<div className="flex flex-col gap-1.5">
			<Field
				id={id}
				label={
					required ? (
						<>
							{label}
							<span className="text-muted-foreground">(required)</span>
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
						className={cn("max-h-80 min-h-28 font-mono", className)}
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
						className={cn("font-mono", className)}
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
	open,
	onInsert,
}: {
	flow: Flow;
	nodeId: string | null;
	open: boolean;
	onInsert: (variable: TemplateVariable) => void;
}) {
	const flows = useProjectFlowMap();
	const groups = templateVariables(flow, nodeId, flows);

	return (
		<details className="group/vars border bg-muted/30 text-xs" open={open}>
			<summary className="cursor-pointer select-none px-2 py-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
				Template variables · click to insert
			</summary>
			<dl className="flex flex-col gap-1.5 border-t px-2 py-2">
				{groups.map(({ scope, variables }) => (
					<div key={scope} className="flex flex-col gap-1">
						<dt className="font-mono text-muted-foreground">{scope}</dt>
						<dd className="flex flex-wrap gap-1">
							{variables.map((variable) => (
								<button
									key={variable.text}
									type="button"
									className="border bg-background px-1 py-0.5 font-mono text-[11px] outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
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
								</button>
							))}
						</dd>
					</div>
				))}
			</dl>
			<div className="flex flex-col gap-1 border-t px-2 py-1.5 text-muted-foreground">
				<p>
					A value marked <span className="font-mono">.…</span> holds JSON: add a
					path, such as{" "}
					<code className="font-mono">{"{{planner.data.tasks}}"}</code> or{" "}
					<code className="font-mono">{"{{item.title}}"}</code>.
				</p>
				<p>A node that has not run yet renders as an empty string.</p>
			</div>
		</details>
	);
}
