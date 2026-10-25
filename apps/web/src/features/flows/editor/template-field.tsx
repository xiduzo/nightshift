import type { Flow } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	Command,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@nightshift/ui/components/command";
import { Input } from "@nightshift/ui/components/input";
import { Popover, PopoverContent } from "@nightshift/ui/components/popover";
import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { BracesIcon, ChevronRightIcon } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

import {
	completeTemplate,
	matchVariables,
	openTemplate,
	type TemplateVariable,
	templateVariables,
	type VariableGroup,
} from "../flow-draft";

import { Field, Note, Optional } from "./fields";
import { useProjectFlowMap } from "./project-flows-context";

/**
 * A text field that takes `{{name.path}}` templates, with the variables it
 * can use below it: the flow's inputs, other nodes' outputs, and `run`.
 * Clicking one inserts it at the cursor. Typing `{{` lists the variables that
 * match what follows it, to pick with the arrow keys and Enter or Tab. A JSON value (an Agent's `data`, a
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
	initialValue,
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
	/** A variable's initial value: it reads the inputs and run only. */
	initialValue?: boolean;
	required?: boolean;
}) {
	const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
	const flows = useProjectFlowMap();
	const groups = templateVariables(flow, nodeId, { flows, initialValue });

	const moveCursor = (field: HTMLTextAreaElement | null, cursor: number) => {
		requestAnimationFrame(() => {
			if (!field) return;
			field.focus();
			field.setSelectionRange(cursor, cursor);
		});
	};

	const insert = (variable: TemplateVariable) => {
		const field = ref.current;
		const start = field?.selectionStart ?? value.length;
		const end = field?.selectionEnd ?? value.length;
		onChange(value.slice(0, start) + variable.text + value.slice(end));
		// A JSON value: the cursor waits before `}}` for a `.path`.
		moveCursor(field, start + variable.text.length - (variable.json ? 2 : 0));
	};

	const suggest = useTemplateSuggestions(value, groups);
	const complete = (variable: TemplateVariable) => {
		if (!suggest.open) return;
		const next = completeTemplate(
			value,
			suggest.cursor,
			suggest.open,
			variable,
		);
		onChange(next.text);
		moveCursor(ref.current, next.cursor);
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
						{...suggest.fieldProps}
						onChange={(event) => {
							onChange(event.target.value);
							suggest.track(event.target);
						}}
						onKeyDown={(event) => suggest.onKeyDown(event, complete)}
					/>
				) : (
					<Input
						ref={ref}
						id={id}
						value={value}
						placeholder={placeholder}
						className={cn("font-mono text-xs", className)}
						spellCheck={false}
						aria-invalid={invalid}
						aria-required={required}
						aria-describedby={describedBy}
						{...suggest.fieldProps}
						onChange={(event) => {
							onChange(event.target.value);
							suggest.track(event.target);
						}}
						onKeyDown={(event) => suggest.onKeyDown(event, complete)}
					/>
				)}
			</Field>
			<TemplateSuggestions anchor={ref} suggest={suggest} onPick={complete} />
			<TemplateVariables groups={groups} onInsert={insert} />
		</div>
	);
}

/** The variables a field can use, grouped by name; a click inserts one. */
function TemplateVariables({
	groups,
	onInsert,
}: {
	groups: readonly VariableGroup[];
	onInsert: (variable: TemplateVariable) => void;
}) {
	return (
		<Collapsible className="rounded-lg border border-dashed">
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

type Suggestions = ReturnType<typeof useTemplateSuggestions>;

/**
 * The variables to offer while the cursor is in an open `{{`: what matches
 * the name typed so far, and which one the arrow keys point at. Escape
 * hides them until the next `{{`.
 */
function useTemplateSuggestions(
	value: string,
	groups: readonly VariableGroup[],
) {
	const listId = useId();
	const [cursor, setCursor] = useState<number | null>(null);
	const [dismissed, setDismissed] = useState<number | null>(null);
	// The option the arrow keys point at, for the name it was picked for.
	const [active, setActive] = useState({ query: "", index: 0 });

	const open = cursor === null ? null : openTemplate(value, cursor);
	const matches = open ? matchVariables(groups, open.query) : [];
	const options = matches.flatMap((group) => group.variables);
	const shown = open !== null && options.length > 0 && dismissed !== open.start;
	// A new name typed: point at the first match again.
	const query = open?.query ?? "";
	const index = active.query === query ? active.index : 0;
	const highlighted = options[Math.min(index, options.length - 1)];

	const track = (field: HTMLTextAreaElement | HTMLInputElement) => {
		setCursor(
			field.selectionStart === field.selectionEnd ? field.selectionStart : null,
		);
	};

	const onKeyDown = (
		event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
		pick: (variable: TemplateVariable) => void,
	) => {
		if (!shown || !open) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setActive({
				query,
				index:
					(Math.min(index, options.length - 1) + step + options.length) %
					options.length,
			});
		} else if ((event.key === "Enter" || event.key === "Tab") && highlighted) {
			event.preventDefault();
			pick(highlighted);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			setDismissed(open.start);
		}
	};

	return {
		listId,
		open: shown ? open : null,
		cursor: cursor ?? value.length,
		matches,
		highlighted,
		point: (text: string) =>
			setActive({
				query,
				index: Math.max(
					0,
					options.findIndex((option) => option.text === text),
				),
			}),
		dismiss: () => open && setDismissed(open.start),
		track,
		onKeyDown,
		fieldProps: {
			autoComplete: "off",
			"aria-autocomplete": "list" as const,
			"aria-controls": shown ? listId : undefined,
			onSelect: (event: {
				currentTarget: HTMLTextAreaElement | HTMLInputElement;
			}) => track(event.currentTarget),
			onBlur: () => setCursor(null),
		},
	};
}

/** The matching variables, in a list below the field. */
function TemplateSuggestions({
	anchor,
	suggest,
	onPick,
}: {
	anchor: RefObject<HTMLElement | null>;
	suggest: Suggestions;
	onPick: (variable: TemplateVariable) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const highlighted = suggest.highlighted?.text;
	useEffect(() => {
		if (!highlighted) return;
		listRef.current
			?.querySelector("[data-selected=true]")
			?.scrollIntoView({ block: "nearest" });
	}, [highlighted]);

	return (
		<Popover
			open={suggest.open !== null}
			onOpenChange={(open, details) => {
				if (!open && details.reason === "escape-key") suggest.dismiss();
			}}
		>
			<PopoverContent
				anchor={anchor}
				align="start"
				initialFocus={false}
				finalFocus={false}
				// Keep the cursor in the field while you pick with the mouse.
				onMouseDown={(event) => event.preventDefault()}
				className="w-(--anchor-width) min-w-64 gap-0 p-0"
			>
				<Command
					value={highlighted ?? ""}
					onValueChange={suggest.point}
					shouldFilter={false}
					className="rounded-md!"
				>
					<CommandList id={suggest.listId} ref={listRef} className="max-h-60">
						{suggest.matches.map(({ scope, variables }) => (
							<CommandGroup key={scope} heading={scope}>
								{variables.map((variable) => (
									<CommandItem
										key={variable.text}
										value={variable.text}
										onSelect={() => onPick(variable)}
										className="font-mono text-xs"
									>
										<span className="truncate">{variable.text}</span>
										{variable.description ? (
											<span className="ml-auto max-w-[50%] truncate font-sans text-muted-foreground">
												{variable.description}
											</span>
										) : null}
									</CommandItem>
								))}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
