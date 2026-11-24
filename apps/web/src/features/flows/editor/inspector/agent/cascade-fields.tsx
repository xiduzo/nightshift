/**
 * The cascade of a node (ADR 6): the tiers it climbs, cheap first. Each
 * tier names a profile (an Agent, a Decision or a Value) or a flow (a
 * Subflow) and how often it tries. The last tier can be you. An Agent with
 * a cascade can have a check: a command that runs after each try.
 */
import {
	type CascadeNode,
	type Flow,
	isPersonTier,
	type PersonTier,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { ItemGroup } from "@nightshift/ui/components/item";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import {
	Field,
	InspectorSection,
	Note,
	SwitchField,
	withOptional,
} from "../form";
import { GateBriefSection, withBrief } from "../gate";
import { PersonDeadline } from "./cascade-person-deadline";
import { TierItem } from "./cascade-tier-item";
import type { ModelTier, Tier } from "./cascade-tiers";
import { withCascade, withoutCascade, withTiers } from "./cascade-tiers";

export function CascadeSection<N extends CascadeNode>({
	projectId,
	flow,
	node,
	flowNames,
	onChange,
}: {
	projectId: string;
	/** The flow: the person tier's brief takes templates. */
	flow: Flow;
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
		<>
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

				<SwitchField
					id={`${id}-person`}
					label="Ask me when no tier holds"
					description={
						node.type === "decision"
							? "A Gate shows what each tier picked. You pick the option."
							: node.type === "value"
								? "A form shows what each try did, filled in with the best answer. You correct it and send it."
								: "A Gate shows what each try did. You can try once more on the last tier, with a note, or stop."
					}
					checked={person !== undefined}
					onChange={(on) =>
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
				{person ? (
					<PersonDeadline
						id={`${id}-deadline`}
						node={node}
						tier={person}
						onChange={(deadline) =>
							change((all) =>
								all.map((tier) => {
									if (!isPersonTier(tier)) return tier;
									return withOptional(tier, "deadline", deadline);
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
			{person ? (
				<GateBriefSection
					flow={flow}
					nodeId={node.id}
					fields={person}
					options={
						node.type === "decision"
							? node.options.map((option) => option.name)
							: null
					}
					tab="setup"
					onChange={(brief) =>
						change((all) =>
							all.map((tier) =>
								isPersonTier(tier) ? withBrief(tier, brief) : tier,
							),
						)
					}
				/>
			) : null}
		</>
	);
}
