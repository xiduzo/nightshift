import type {
	AgentTier,
	CallTier,
	CascadeNode,
	DecisionTier,
	ValueTier,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOptGroup,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { Field, PositiveIntInput } from "../form";
import { KitOptions } from "../kits";
import type { ModelTier } from "./cascade-tiers";
import {
	ProfileSelect,
	profileProblem,
	useAgentProfiles,
	useModelProfiles,
} from "./profile-select";

/** One tier: what it runs on, how often it tries, and what makes a try hold. */
export function TierItem<N extends CascadeNode>({
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
						<KitOptions current={(tier as CallTier).flow ?? ""} />
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
