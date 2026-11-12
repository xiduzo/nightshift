/** The fields of a Since last run node: what it watches, how it compares, and what it remembers. */
import {
	type Flow,
	type SinceLastRunNode,
	watchesValue,
} from "@nightshift/flows";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useId } from "react";
import { Field, InspectorSection, Note } from "../fields";
import { TemplateField } from "../template-field";
import { MemorySection } from "./memory-section";

type Watch = "list" | "value";

const WATCH: { watch: Watch; label: string }[] = [
	{ watch: "list", label: "A list" },
	{ watch: "value", label: "A value" },
];

/** The node as it watches a list, or a value: the fields of the other one go. */
function withWatch(node: SinceLastRunNode, watch: Watch): SinceLastRunNode {
	const { items: _items, key, compare, value: _value, when, ...rest } = node;
	return watch === "list"
		? {
				...rest,
				items: node.items ?? "",
				...(key === undefined ? {} : { key }),
				...(compare === undefined ? {} : { compare }),
			}
		: {
				...rest,
				value: node.value ?? "",
				...(when === undefined ? {} : { when }),
			};
}

/** The paths of `compare` as one line, and back. */
const pathsText = (paths: readonly string[] | undefined) =>
	(paths ?? []).join(", ");
const pathsOf = (text: string) =>
	text
		.split(",")
		.map((path) => path.trim())
		.filter((path) => path !== "");

/**
 * A Since last run node: a list with the key of an item and the fields
 * that count, or one value with a rule over `previous` and `current`. A
 * scope splits its memory, and the first run finds everything new or
 * nothing. Under Results: what it remembers, and Forget what it saw.
 */
export function SinceLastRunFields({
	projectId,
	flowName,
	flow,
	node,
	onChange,
}: {
	projectId: string;
	/** The flow open in the editor: its runs keep the memory. */
	flowName: string;
	flow: Flow;
	node: SinceLastRunNode;
	onChange: (change: (node: SinceLastRunNode) => SinceLastRunNode) => void;
}) {
	const id = useId();
	const watch: Watch = watchesValue(node) ? "value" : "list";
	const set = <K extends keyof SinceLastRunNode>(
		key: K,
		value: SinceLastRunNode[K] | undefined,
	) =>
		onChange((current) => {
			const { [key]: _, ...rest } = current;
			return (
				value === undefined ? rest : { ...rest, [key]: value }
			) as SinceLastRunNode;
		});
	return (
		<>
			<InspectorSection title="Since last run">
				<Field
					id={`${id}-watch`}
					label="Watch"
					hint="A list finds new and changed items. A value finds a change, such as a price that passes a limit."
				>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Watch"
						className="w-full"
						value={[watch]}
						onValueChange={(value) => {
							const next = value[0] as Watch | undefined;
							if (next) onChange((current) => withWatch(current, next));
						}}
					>
						{WATCH.map((entry) => (
							<ToggleGroupItem
								key={entry.watch}
								value={entry.watch}
								className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								{entry.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</Field>
				{watch === "list" ? (
					<>
						<TemplateField
							id={`${id}-items`}
							label="List"
							hint="The items to compare with the last run."
							flow={flow}
							nodeId={node.id}
							value={node.items ?? ""}
							placeholder="{{feed.data.items}}"
							multiline={false}
							invalid={(node.items ?? "").trim() === ""}
							onChange={(items) =>
								onChange((current) => ({ ...current, items }))
							}
						/>
						<Field
							id={`${id}-key`}
							label="Key"
							optional
							hint="The field that names an item. Empty: the item itself."
						>
							<Input
								id={`${id}-key`}
								value={node.key ?? ""}
								placeholder="link"
								className="font-mono text-xs"
								autoComplete="off"
								spellCheck={false}
								aria-describedby={`${id}-key-hint`}
								onChange={(event) =>
									set("key", event.target.value.trim() || undefined)
								}
							/>
						</Field>
						<Field
							id={`${id}-compare`}
							label="Compare"
							optional
							hint="The fields whose change counts. Empty: any change of the item."
						>
							<Input
								id={`${id}-compare`}
								defaultValue={pathsText(node.compare)}
								key={pathsText(node.compare)}
								placeholder="title, price"
								className="font-mono text-xs"
								autoComplete="off"
								spellCheck={false}
								aria-describedby={`${id}-compare-hint`}
								onBlur={(event) => {
									const paths = pathsOf(event.target.value);
									set("compare", paths.length > 0 ? paths : undefined);
								}}
							/>
						</Field>
					</>
				) : (
					<>
						<TemplateField
							id={`${id}-value`}
							label="Value"
							hint="The value to compare with the last run."
							flow={flow}
							nodeId={node.id}
							value={node.value ?? ""}
							placeholder="{{price.data.usd}}"
							multiline={false}
							invalid={(node.value ?? "").trim() === ""}
							onChange={(value) =>
								onChange((current) => ({ ...current, value }))
							}
						/>
						<Field
							id={`${id}-when`}
							label="Changed when"
							optional
							hint="A rule over previous and current. Empty: any change."
						>
							<Input
								id={`${id}-when`}
								value={node.when ?? ""}
								placeholder="current > 100 and previous <= 100"
								className="font-mono text-xs"
								autoComplete="off"
								spellCheck={false}
								aria-describedby={`${id}-when-hint`}
								onChange={(event) =>
									set("when", event.target.value || undefined)
								}
							/>
						</Field>
					</>
				)}
				<TemplateField
					id={`${id}-scope`}
					label="Scope"
					hint="Each value of the scope has its own memory, for example one per feed."
					flow={flow}
					nodeId={node.id}
					value={node.scope ?? ""}
					placeholder="{{feed_url}}"
					multiline={false}
					onChange={(scope) => set("scope", scope === "" ? undefined : scope)}
				/>
				<Field
					id={`${id}-first`}
					label="First run"
					hint="What the run finds when the node remembers nothing yet."
				>
					<NativeSelect
						id={`${id}-first`}
						value={node.firstRun ?? "new"}
						aria-describedby={`${id}-first-hint`}
						onChange={(event) =>
							set(
								"firstRun",
								event.target.value === "same" ? "same" : undefined,
							)
						}
					>
						<NativeSelectOption value="new">
							Everything is new
						</NativeSelectOption>
						<NativeSelectOption value="same">Nothing is new</NativeSelectOption>
					</NativeSelect>
				</Field>
				<Note>
					Draw an edge for each outcome that continues the run: <code>new</code>
					, <code>changed</code> or <code>same</code>. <code>data.new</code> and{" "}
					<code>data.changed</code> hold the items.
				</Note>
			</InspectorSection>
			<MemorySection projectId={projectId} flowName={flowName} node={node} />
		</>
	);
}
