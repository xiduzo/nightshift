/**
 * The cascade of a node (ADR 6): the tiers it climbs, cheap first. Each
 * tier names a profile (an Agent, a Decision or a Value) or a flow (a
 * Subflow) and how often it tries. The last tier can be you. An Agent with
 * a cascade can have a check: a command that runs after each try.
 */
import {
	type AgentTier,
	type CallTier,
	type CascadeNode,
	type DecisionTier,
	isPersonTier,
	kitList,
	type PersonTier,
	type ValueTier,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	FieldContent,
	FieldDescription,
	FieldLabel,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOptGroup,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Switch } from "@nightshift/ui/components/switch";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { Field, InspectorSection, Note, PositiveIntInput } from "../fields";
import {
	ProfileSelect,
	profileProblem,
	useAgentProfiles,
	useModelProfiles,
} from "./profile-select";

type ModelTier = AgentTier | DecisionTier | ValueTier | CallTier;
type Tier = ModelTier | PersonTier;

/** The choices of the person tier of an Agent or a Subflow. */
const RETRY_CHOICES = [
	{ name: "try-again", label: "Try again" },
	{ name: "stop", label: "Stop" },
] as const;

const KITS = kitList();

/** The node's first tier from what it runs on now: its profile, or its own model. */
function firstTier(node: CascadeNode): ModelTier {
	switch (node.type) {
		case "agent":
			return node.profile !== undefined
				? { profile: node.profile }
				: {
						...(node.harness !== undefined ? { harness: node.harness } : {}),
						...(node.model !== undefined ? { model: node.model } : {}),
					};
		case "decision":
		case "value":
			return node.profile !== undefined
				? { profile: node.profile }
				: {
						...(node.decider !== undefined ? { decider: node.decider } : {}),
						...(node.model !== undefined ? { model: node.model } : {}),
					};
		case "call":
			return {};
	}
}

/** The node with a cascade of two tiers, both on what it runs on now: you change the second. */
function withCascade<N extends CascadeNode>(node: N): N {
	const tier = firstTier(node);
	const {
		profile: _profile,
		model: _model,
		...rest
	} = node as N & { profile?: unknown; model?: unknown };
	const {
		harness: _harness,
		decider: _decider,
		...plain
	} = rest as typeof rest & {
		harness?: unknown;
		decider?: unknown;
	};
	return { ...plain, cascade: [tier, { ...tier }] } as unknown as N;
}

/** The node without its cascade, back on its first tier's profile or model. */
function withoutCascade<N extends CascadeNode>(node: N): N {
	const { cascade, check: _check, ...rest } = node as N & { check?: string };
	const first = (cascade ?? []).find((tier) => !isPersonTier(tier)) as
		| (ModelTier & Record<string, unknown>)
		| undefined;
	if (node.type === "call" || first === undefined) return rest as N;
	const keep = ["profile", "harness", "model", "decider"] as const;
	const back = Object.fromEntries(
		keep.flatMap((key) =>
			first[key] !== undefined ? [[key, first[key]]] : [],
		),
	);
	if (node.type === "agent" && back.profile === undefined) {
		back.harness ??= "claude-code";
	}
	return { ...rest, ...back } as N;
}

/** The tiers of the node, changed by `change`. */
function withTiers<N extends CascadeNode>(
	node: N,
	change: (tiers: Tier[]) => Tier[],
): N {
	return { ...node, cascade: change([...(node.cascade ?? [])]) } as N;
}

export function CascadeSection<N extends CascadeNode>({
	projectId,
	node,
	flowNames,
	onChange,
}: {
	projectId: string;
	node: N;
	/** A Subflow's choices for a tier: the project's other flows. */
	flowNames?: readonly string[];
	onChange: (change: (node: N) => N) => void;
}) {
	const id = useId();
	const tiers: readonly Tier[] = node.cascade ?? [];
	const person = tiers.find((tier) => isPersonTier(tier)) as
		| PersonTier
		| undefined;
	const models = tiers.filter((tier) => !isPersonTier(tier));
	// A Value cannot ask you yet: that comes with the Ask of a Value.
	const canAsk = node.type !== "value";

	if (node.cascade === undefined) {
		return (
			<InspectorSection title="Cascade" tab="setup" defaultOpen={false}>
				<Note>
					Try a cheap tier first. When a try does not hold, Night Shift tries
					again, then moves up to the next tier.
				</Note>
				<Button
					variant="outline"
					size="sm"
					className="w-fit"
					onClick={() => onChange((current) => withCascade(current))}
				>
					<PlusIcon data-icon="inline-start" />
					Add a cascade
				</Button>
			</InspectorSection>
		);
	}

	const change = (fn: (tiers: Tier[]) => Tier[]) =>
		onChange((current) => withTiers(current, fn));
	const move = (index: number, by: -1 | 1) =>
		change((all) => {
			const next = [...all];
			const [tier] = next.splice(index, 1);
			if (tier) next.splice(index + by, 0, tier);
			return next;
		});

	return (
		<InspectorSection
			title="Cascade"
			tab="setup"
			description={`A try that does not hold tries again, then moves to the next tier. Later nodes read the tier that held as {{${node.id}.tier}}.`}
		>
			<ItemGroup className="gap-2">
				{models.map((tier, index) => (
					<TierItem
						// The tiers have no ids: the position is the key.
						key={`${index}-${models.length}`}
						projectId={projectId}
						node={node}
						tier={tier}
						index={index}
						count={models.length}
						flowNames={flowNames}
						onChange={(patch) =>
							change((all) =>
								all.map((each, at) =>
									at === index
										? (Object.fromEntries(
												Object.entries({ ...each, ...patch }).filter(
													([, value]) => value !== undefined,
												),
											) as Tier)
										: each,
								),
							)
						}
						onClear={(key) =>
							change((all) =>
								all.map((each, at) => {
									if (at !== index) return each;
									const { [key]: _gone, ...rest } = each as Record<
										string,
										unknown
									>;
									return rest as Tier;
								}),
							)
						}
						onMove={(by) => move(index, by)}
						onRemove={() =>
							change((all) => all.filter((_each, at) => at !== index))
						}
					/>
				))}
			</ItemGroup>
			<Button
				variant="outline"
				size="sm"
				className="w-fit"
				disabled={tiers.length >= 8}
				onClick={() =>
					change((all) => {
						const last = all.filter((tier) => !isPersonTier(tier)).at(-1);
						const { label: _label, ...copy } = (last ?? {}) as ModelTier;
						const at = person ? all.length - 1 : all.length;
						return [...all.slice(0, at), copy, ...all.slice(at)];
					})
				}
			>
				<PlusIcon data-icon="inline-start" />
				Add tier
			</Button>

			{canAsk ? (
				<ShadcnField orientation="horizontal" className="items-start">
					<Switch
						id={`${id}-person`}
						checked={person !== undefined}
						className="mt-0.5"
						aria-describedby={`${id}-person-hint`}
						onCheckedChange={(on) =>
							change((all) =>
								on
									? [
											...all.filter((tier) => !isPersonTier(tier)),
											{ person: true },
										]
									: all.filter((tier) => !isPersonTier(tier)),
							)
						}
					/>
					<FieldContent>
						<FieldLabel htmlFor={`${id}-person`}>
							Ask me when no tier holds
						</FieldLabel>
						<FieldDescription id={`${id}-person-hint`} className="text-xs">
							{node.type === "decision"
								? "A Gate shows what each tier picked. You pick the option."
								: "A Gate shows what each try did. You can try once more on the last tier, with a note, or stop."}
						</FieldDescription>
					</FieldContent>
				</ShadcnField>
			) : null}
			{person ? (
				<PersonDeadline
					id={`${id}-deadline`}
					node={node}
					tier={person}
					onChange={(deadline) =>
						change((all) =>
							all.map((tier) => {
								if (!isPersonTier(tier)) return tier;
								const { deadline: _old, ...rest } = tier;
								return deadline ? { ...rest, deadline } : rest;
							}),
						)
					}
				/>
			) : null}

			{node.type === "agent" ? (
				<Field
					id={`${id}-check`}
					label="Check"
					optional
					hint="A command that runs after each try that passes, in the run's copy of the project. The try holds only when it exits 0."
				>
					<Input
						id={`${id}-check`}
						className="font-mono"
						value={node.check ?? ""}
						placeholder="bun test"
						aria-describedby={`${id}-check-hint`}
						onChange={(event) => {
							const check = event.target.value;
							onChange((current) => {
								const { check: _old, ...rest } = current as N & {
									check?: string;
								};
								return (check.trim() === "" ? rest : { ...rest, check }) as N;
							});
						}}
					/>
				</Field>
			) : null}

			<Button
				variant="ghost"
				size="sm"
				className="-ml-2 w-fit text-muted-foreground"
				onClick={() => onChange((current) => withoutCascade(current))}
			>
				<Trash2Icon data-icon="inline-start" />
				Remove the cascade
			</Button>
		</InspectorSection>
	);
}

/** One tier: what it runs on, how often it tries, and what makes a try hold. */
function TierItem<N extends CascadeNode>({
	projectId,
	node,
	tier,
	index,
	count,
	flowNames,
	onChange,
	onClear,
	onMove,
	onRemove,
}: {
	projectId: string;
	node: N;
	tier: ModelTier;
	index: number;
	count: number;
	flowNames: readonly string[] | undefined;
	onChange: (patch: Partial<Record<string, unknown>>) => void;
	onClear: (key: string) => void;
	onMove: (by: -1 | 1) => void;
	onRemove: () => void;
}) {
	const id = useId();
	const number = index + 1;
	const set = (key: string, value: unknown) =>
		value === undefined ? onClear(key) : onChange({ [key]: value });
	return (
		<Item variant="outline" size="sm" className="flex-col items-stretch gap-3">
			<div className="flex items-center gap-2">
				<ItemContent className="min-w-0">
					<ItemTitle>Tier {number}</ItemTitle>
				</ItemContent>
				<ItemActions className="gap-0.5">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Move tier ${number} up`}
						disabled={index === 0}
						onClick={() => onMove(-1)}
					>
						<ArrowUpIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Move tier ${number} down`}
						disabled={index === count - 1}
						onClick={() => onMove(1)}
					>
						<ArrowDownIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Remove tier ${number}`}
						disabled={count === 1}
						onClick={onRemove}
					>
						<Trash2Icon />
					</Button>
				</ItemActions>
			</div>
			<Field id={`${id}-label`} label="Name" optional>
				<Input
					id={`${id}-label`}
					value={tier.label ?? ""}
					placeholder={String(number)}
					onChange={(event) =>
						set(
							"label",
							event.target.value.trim() === "" ? undefined : event.target.value,
						)
					}
				/>
			</Field>
			{node.type === "agent" ? (
				<AgentTierProfile
					id={`${id}-profile`}
					projectId={projectId}
					tier={tier as AgentTier}
					onChange={onChange}
				/>
			) : node.type === "call" ? (
				<Field id={`${id}-flow`} label="Flow">
					<NativeSelect
						id={`${id}-flow`}
						className="font-mono"
						value={(tier as CallTier).flow ?? ""}
						onChange={(event) =>
							set(
								"flow",
								event.target.value === "" ? undefined : event.target.value,
							)
						}
					>
						<NativeSelectOption value="">The node's flow</NativeSelectOption>
						<NativeSelectOptGroup label="This project">
							{(flowNames ?? []).map((name) => (
								<NativeSelectOption key={name} value={name}>
									{name}
								</NativeSelectOption>
							))}
						</NativeSelectOptGroup>
						<NativeSelectOptGroup label="Kits">
							{KITS.map(({ name }) => (
								<NativeSelectOption key={name} value={name}>
									{name}
								</NativeSelectOption>
							))}
						</NativeSelectOptGroup>
					</NativeSelect>
				</Field>
			) : (
				<ModelTierProfile
					id={`${id}-profile`}
					projectId={projectId}
					tier={tier as DecisionTier}
					onChange={onChange}
				/>
			)}
			<Field
				id={`${id}-tries`}
				label="Tries"
				optional
				hint="How often this tier tries before the next one. Empty: once."
			>
				<PositiveIntInput
					id={`${id}-tries`}
					value={tier.tries}
					placeholder="1"
					describedBy={`${id}-tries-hint`}
					onChange={(tries) => set("tries", tries)}
				/>
			</Field>
			{node.type === "decision" ? (
				<Field
					id={`${id}-confidence`}
					label="Least confidence"
					optional
					hint="A pick below this, from 0 to 1, goes to the next tier. Empty: every pick holds."
					error={
						((tier as DecisionTier).minConfidence ?? 0) > 1
							? "Use a number from 0 to 1, such as 0.8."
							: null
					}
				>
					<PositiveIntInput
						id={`${id}-confidence`}
						decimal
						value={(tier as DecisionTier).minConfidence}
						placeholder="0.8"
						describedBy={`${id}-confidence-hint`}
						onChange={(value) => set("minConfidence", value)}
					/>
				</Field>
			) : null}
			{node.type === "value" ? (
				<Field
					id={`${id}-accept`}
					label="Accept rule"
					optional
					hint="A rule over the value as data. A value that fails it goes to the next tier."
				>
					<Input
						id={`${id}-accept`}
						className="font-mono"
						value={(tier as ValueTier).accept ?? ""}
						placeholder="$count(data.tasks) > 0"
						onChange={(event) =>
							set(
								"accept",
								event.target.value.trim() === ""
									? undefined
									: event.target.value,
							)
						}
					/>
				</Field>
			) : null}
			{node.type === "agent" ? (
				<Field
					id={`${id}-session`}
					label="Next try in this tier"
					hint="Resume continues where the agent stopped. A new tier always starts fresh."
				>
					<NativeSelect
						id={`${id}-session`}
						value={(tier as AgentTier).session ?? "fresh"}
						aria-describedby={`${id}-session-hint`}
						onChange={(event) =>
							set(
								"session",
								event.target.value === "resume" ? "resume" : undefined,
							)
						}
					>
						<NativeSelectOption value="fresh">Fresh session</NativeSelectOption>
						<NativeSelectOption value="resume">
							Resume the session
						</NativeSelectOption>
					</NativeSelect>
				</Field>
			) : null}
		</Item>
	);
}

/** An Agent tier's profile: the computer and the agent its tries run with. */
function AgentTierProfile({
	id,
	projectId,
	tier,
	onChange,
}: {
	id: string;
	projectId: string;
	tier: AgentTier;
	onChange: (patch: Partial<Record<string, unknown>>) => void;
}) {
	const found = useAgentProfiles(projectId, tier.profile);
	const problem = profileProblem(found);
	return (
		<Field id={id} label="Profile" error={problem}>
			<ProfileSelect
				id={id}
				value={tier.profile}
				choices={found.choices}
				invalid={problem !== null}
				none={
					tier.harness !== undefined && tier.model !== undefined
						? `${tier.harness} · ${tier.model}`
						: "Pick a profile"
				}
				label={(profile) => profile.model}
				onPick={(next) =>
					onChange(
						next
							? { profile: next.ref, harness: undefined, model: undefined }
							: { profile: undefined },
					)
				}
			/>
		</Field>
	);
}

/** A Decision's or a Value's tier: the Model Profile its tries ask. */
function ModelTierProfile({
	id,
	projectId,
	tier,
	onChange,
}: {
	id: string;
	projectId: string;
	tier: DecisionTier | ValueTier;
	onChange: (patch: Partial<Record<string, unknown>>) => void;
}) {
	const found = useModelProfiles(projectId, tier.profile);
	const problem = profileProblem(found);
	return (
		<Field id={id} label="Profile" error={problem}>
			<ProfileSelect
				id={id}
				value={tier.profile}
				choices={found.choices}
				invalid={problem !== null}
				none={
					tier.decider !== undefined
						? `${tier.decider}${tier.model ? ` · ${tier.model}` : ""}`
						: "The default model"
				}
				label={(profile) =>
					profile.model
						? `${profile.decider} · ${profile.model}`
						: profile.decider
				}
				onPick={(next) =>
					onChange(
						next
							? { profile: next.ref, decider: undefined, model: undefined }
							: { profile: undefined },
					)
				}
			/>
		</Field>
	);
}

/** When the person tier stops waiting, and what it chooses then. */
function PersonDeadline<N extends CascadeNode>({
	id,
	node,
	tier,
	onChange,
}: {
	id: string;
	node: N;
	tier: PersonTier;
	onChange: (deadline: PersonTier["deadline"]) => void;
}) {
	const choices =
		node.type === "decision"
			? node.options.map((option) => ({
					name: option.name,
					label: option.name,
				}))
			: RETRY_CHOICES;
	const deadline = tier.deadline;
	return (
		<div className="grid grid-cols-2 gap-3">
			<Field
				id={`${id}-minutes`}
				label="Choose after (min)"
				optional
				hint="When you do not answer in time, Night Shift chooses for you."
			>
				<PositiveIntInput
					id={`${id}-minutes`}
					value={deadline?.minutes}
					placeholder="None"
					describedBy={`${id}-minutes-hint`}
					onChange={(minutes) =>
						onChange(
							minutes === undefined
								? undefined
								: {
										minutes,
										choose: deadline?.choose ?? choices[0]?.name ?? "stop",
									},
						)
					}
				/>
			</Field>
			<Field id={`${id}-choose`} label="Then choose">
				<NativeSelect
					id={`${id}-choose`}
					value={deadline?.choose ?? ""}
					disabled={deadline === undefined}
					onChange={(event) =>
						deadline && onChange({ ...deadline, choose: event.target.value })
					}
				>
					{deadline === undefined ? (
						<NativeSelectOption value="">Set a time first</NativeSelectOption>
					) : null}
					{choices.map((choice) => (
						<NativeSelectOption key={choice.name} value={choice.name}>
							{choice.label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>
		</div>
	);
}
