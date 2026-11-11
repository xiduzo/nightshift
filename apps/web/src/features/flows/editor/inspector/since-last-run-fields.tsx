/** The fields of a Since last run node: what it watches, how it compares, and what it remembers. */
import {
	type Flow,
	MAX_MEMORY_KEYS,
	type SinceLastRunNode,
	watchesValue,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { formatRelative } from "@/shared/format";
import { flowMutations, flowQueries } from "../../queries";
import { Field, InspectorSection, Note } from "../fields";
import { TemplateField } from "../template-field";

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

/** What the node remembers from the runs of this flow, per scope, and Forget what it saw. */
function MemorySection({
	projectId,
	flowName,
	node,
}: {
	projectId: string;
	flowName: string;
	node: SinceLastRunNode;
}) {
	const queryClient = useQueryClient();
	const query = flowQueries.memory(projectId, flowName);
	const memory = useQuery(query);
	const forget = useMutation(
		flowMutations.forgetMemory({
			onSuccess: () => {
				toast.success("Forgotten. The next run is a first run.");
				void queryClient.invalidateQueries({ queryKey: query.queryKey });
			},
			onError: (error) => toast.error(`Could not forget: ${error.message}`),
		}),
	);
	const scopes = (memory.data ?? []).filter((entry) => entry.node === node.id);
	return (
		<InspectorSection title="Memory" tab="results">
			{memory.isLoading ? (
				<Skeleton className="h-6 w-full" />
			) : scopes.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					Nothing remembered yet. The next run is a first run.
				</p>
			) : (
				<ItemGroup className="gap-1">
					{scopes.map((entry) => (
						<Item key={entry.scope} variant="muted" size="xs">
							<ItemContent className="min-w-0">
								<ItemTitle className="text-xs">
									{entry.value !== undefined
										? `Last value: ${JSON.stringify(entry.value)}`
										: `${entry.keys} ${entry.keys === 1 ? "item" : "items"}`}
								</ItemTitle>
								<ItemDescription className="truncate text-xs">
									{entry.scope === "" ? "" : `${entry.scope} · `}
									Saved {formatRelative(entry.updatedAt)}
								</ItemDescription>
							</ItemContent>
							{scopes.length > 1 ? (
								<ItemActions>
									<Button
										variant="ghost"
										size="xs"
										disabled={forget.isPending}
										aria-label={`Forget what it saw for ${entry.scope}`}
										onClick={() =>
											forget.mutate({
												projectId,
												name: flowName,
												node: node.id,
												scope: entry.scope,
											})
										}
									>
										<RotateCcwIcon data-icon="inline-start" />
										Forget
									</Button>
								</ItemActions>
							) : null}
						</Item>
					))}
				</ItemGroup>
			)}
			{scopes.length > 0 ? (
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					disabled={forget.isPending}
					onClick={() =>
						forget.mutate({ projectId, name: flowName, node: node.id })
					}
				>
					<RotateCcwIcon data-icon="inline-start" />
					Forget what it saw
				</Button>
			) : null}
			<Note>
				It saves what it saw when its step ends, also when a later step fails.
				It keeps up to {MAX_MEMORY_KEYS.toLocaleString("en")} items. A quick run
				remembers nothing.
			</Note>
		</InspectorSection>
	);
}
