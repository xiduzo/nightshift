/** The options, outcomes or exits of a node: shared by Agent, Command and Decision nodes. */
import {
	type NodeOption,
	nodeOptions,
	type OptionNode,
	withOptions,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import type { ReactNode } from "react";
import { InspectorSection } from "../fields";
import { OptionsEditor } from "../options-editor";

/** What a node's list is called, as its section title. */
const OPTION_TITLES = {
	option: "Options",
	outcome: "Outcomes",
	exit: "Exit codes",
} as const;

/** A Decision's options are its work; outcomes and exits are what it gives later nodes. */
const OPTION_TABS = {
	option: "work",
	outcome: "results",
	exit: "results",
} as const;

/** The options, outcomes or exits of a node, with the edits that keep its edges in step. */
export function NodeOptionsField<T extends OptionNode>({
	id,
	kind,
	node,
	min,
	hint,
	rules = false,
	lead,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
	onCode,
	addControl,
	children,
}: {
	id: string;
	kind: keyof typeof OPTION_TITLES;
	node: T;
	min: number;
	hint: string;
	/** Each option takes a rule (a Decision decided by a rule). */
	rules?: boolean;
	/** Above the hint, such as who picks the outcome. */
	lead?: ReactNode;
	onChange: (change: (node: T) => T) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
	/** Command exits: the code of each row. */
	onCode?: (index: number, code: NodeOption["code"]) => void;
	/** Replaces the add button. */
	addControl?: ReactNode;
	/** Below the list, such as a way back to the standard outcomes. */
	children?: ReactNode;
}) {
	const options = nodeOptions(node);
	const change = (edit: (options: NodeOption[]) => NodeOption[]) =>
		onChange((current) => withOptions(current, edit(nodeOptions(current))));

	return (
		<InspectorSection
			title={OPTION_TITLES[kind]}
			tab={OPTION_TABS[kind]}
			aside={
				<Badge variant="secondary" className="tabular-nums">
					{options.length}
				</Badge>
			}
			className="gap-3"
		>
			{lead}
			<p id={`${id}-hint`} className="text-muted-foreground text-xs">
				{hint}
			</p>
			<OptionsEditor
				kind={kind}
				options={options}
				min={min}
				describedBy={`${id}-hint`}
				onRename={onRenameOutcome}
				onRemove={onRemoveOutcome}
				onDescribe={(index, description) =>
					change((list) =>
						list.map((option, at) => {
							if (at !== index) return option;
							const { description: _, ...rest } = option;
							return description === undefined
								? rest
								: { ...rest, description };
						}),
					)
				}
				onRule={
					rules
						? (index, when) =>
								change((list) =>
									list.map((option, at) => {
										if (at !== index) return option;
										const { when: _, ...rest } = option;
										return when === undefined ? rest : { ...rest, when };
									}),
								)
						: undefined
				}
				onCode={onCode}
				onColor={(index, color) =>
					change((list) =>
						list.map((option, at) => {
							if (at !== index) return option;
							const { color: _, ...rest } = option;
							return color === undefined ? rest : { ...rest, color };
						}),
					)
				}
				onAdd={(option) => change((list) => [...list, option])}
				addControl={addControl}
				onMove={(from, to) =>
					change((list) => {
						const next = list.slice();
						const [moved] = next.splice(from, 1);
						if (moved) next.splice(to, 0, moved);
						return next;
					})
				}
			/>
			{children}
		</InspectorSection>
	);
}
