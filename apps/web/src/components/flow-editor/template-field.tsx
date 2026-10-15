import type { Flow } from "@nightshift/flows";
import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { type ReactNode, useRef } from "react";

import { templateVariables } from "@/lib/flow-draft";

import { Field } from "./fields";

/**
 * A textarea that takes `{{node.field}}` templates, with the variables the
 * node can use below it. Clicking one inserts it at the cursor.
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
}: {
	id: string;
	label: ReactNode;
	hint?: ReactNode;
	flow: Flow;
	nodeId: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	invalid?: boolean;
	className?: string;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const variables = templateVariables(flow, nodeId);

	const insert = (variable: string) => {
		const textarea = ref.current;
		const start = textarea?.selectionStart ?? value.length;
		const end = textarea?.selectionEnd ?? value.length;
		onChange(value.slice(0, start) + variable + value.slice(end));
		requestAnimationFrame(() => {
			if (!textarea) return;
			textarea.focus();
			const cursor = start + variable.length;
			textarea.setSelectionRange(cursor, cursor);
		});
	};

	return (
		<>
			<Field id={id} label={label} hint={hint}>
				<Textarea
					ref={ref}
					id={id}
					value={value}
					placeholder={placeholder}
					className={cn("max-h-80 min-h-28 font-mono", className)}
					aria-invalid={invalid}
					aria-describedby={hint ? `${id}-hint` : undefined}
					onChange={(event) => onChange(event.target.value)}
				/>
			</Field>

			<details className="group/vars border bg-muted/30 text-xs" open>
				<summary className="cursor-pointer select-none px-2 py-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
					Template variables · click to insert
				</summary>
				<dl className="flex flex-col gap-1.5 border-t px-2 py-2">
					{variables.map(({ scope, variables: list }) => (
						<div key={scope} className="flex flex-col gap-1">
							<dt className="font-mono text-muted-foreground">{scope}</dt>
							<dd className="flex flex-wrap gap-1">
								{list.map((variable) => (
									<button
										key={variable}
										type="button"
										className="border bg-background px-1 py-0.5 font-mono text-[11px] outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
										onClick={() => insert(variable)}
										title={`Insert ${variable}`}
									>
										{variable.slice(scope.length + 3, -2)}
									</button>
								))}
							</dd>
						</div>
					))}
				</dl>
				<div className="flex flex-col gap-1 border-t px-2 py-1.5 text-muted-foreground">
					{flow.input === "item" ? (
						<p>
							<code className="font-mono">{"{{params.<name>}}"}</code> reads the
							run parameters of the top-level flow.
						</p>
					) : null}
					<p>A node that has not run yet renders as an empty string.</p>
				</div>
			</details>
		</>
	);
}
