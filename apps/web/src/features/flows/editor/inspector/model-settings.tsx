/**
 * The model of a Decision or a Value decided by a model: a Model Profile
 * of one of the person's computers first, and the decider and model as
 * overrides of it. Without a profile, the node sets the decider and the
 * model itself, as before profiles.
 */
import {
	type DecisionNode,
	decisionDecider,
	type ModelProfile,
	type ValueNode,
	valueDecider,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useId } from "react";
import { deciderQueries } from "@/features/agents";
import { Field, InspectorSection } from "../fields";
import { OverrideBadge } from "./agent-fields";
import { deciderModelHint, withoutField } from "./model-defaults";
import {
	type ProfileChoice,
	ProfileSelect,
	profileOnDevice,
	profileProblem,
	useModelProfiles,
} from "./profile-select";

/**
 * The node on another profile, or on none. Picking a profile hands it the
 * decider and the model (the node's own go) and the profile's Device, so
 * the node names no device of its own; picking none keeps what the old
 * profile gave, so the node decides as before.
 */
function pickProfile<N extends DecisionNode | ValueNode>(
	node: N,
	next: ProfileChoice<ModelProfile> | undefined,
	before: ModelProfile | undefined,
): N {
	const { profile: _profile, decider, model, ...rest } = node;
	if (next) {
		const { device: _device, ...free } = rest;
		return { ...free, profile: next.ref } as N;
	}
	const keptDecider = decider ?? before?.decider;
	const keptModel =
		model ?? (decider === undefined ? before?.model : undefined);
	return {
		...rest,
		...(keptDecider !== undefined ? { decider: keptDecider } : {}),
		...(keptModel !== undefined ? { model: keptModel } : {}),
	} as N;
}

export function ModelSettings<N extends DecisionNode | ValueNode>({
	projectId,
	node,
	onChange,
}: {
	projectId: string;
	node: N;
	onChange: (change: (node: N) => N) => void;
}) {
	const id = useId();
	const makes = node.type === "value" ? "value" : "decision";
	const deciders = useQuery(deciderQueries.list());
	const found = useModelProfiles(projectId, node.profile);
	const { choices, chosen } = found;
	const problem = profileProblem(found);
	const profile = chosen?.profile;
	const named = node.profile !== undefined;
	// The decider that runs: the node's own, else the profile's, else the default.
	const deciderName =
		node.decider ??
		profile?.decider ??
		(makes === "value" ? valueDecider(node) : decisionDecider(node));
	const decider = deciders.data?.find((d) => d.name === deciderName);
	const label = (name: string) =>
		deciders.data?.find((d) => d.name === name)?.label ?? name;
	const options =
		makes === "value"
			? (deciders.data ?? []).filter((d) => d.value !== null)
			: (deciders.data ?? []);
	const cannot = makes === "value" && decider !== undefined && !decider.value;
	const keyMissing = decider?.apiKeySource === "missing";
	const defaultModel =
		makes === "value" ? decider?.value?.defaultModel : decider?.defaultModel;
	// The profile's model goes with the profile's decider only.
	const inherited =
		node.decider === undefined
			? (profile?.model ?? defaultModel)
			: defaultModel;
	const models =
		(makes === "value" ? decider?.value?.models : decider?.models) ?? [];
	const fromProfile = (value: string) => `From the profile (${value})`;
	const overrides = [node.decider, node.model].filter(
		(value) => value !== undefined,
	).length;

	const settings = (
		<>
			<Field
				id={`${id}-decider`}
				label={
					<>
						Decider
						{named && node.decider !== undefined ? <OverrideBadge /> : null}
					</>
				}
				error={
					cannot
						? "This decider cannot make a value. Choose one that can."
						: keyMissing && decider?.apiKey
							? `Add the secret ${decider.apiKey} on the Secrets page, or this node cannot ${makes === "value" ? "make a value" : "decide"}.`
							: null
				}
				hint={
					makes === "value"
						? "The decider whose model makes the value."
						: "The decision model that picks the option."
				}
			>
				<NativeSelect
					id={`${id}-decider`}
					value={named ? (node.decider ?? "") : deciderName}
					aria-invalid={keyMissing || cannot}
					aria-describedby={`${id}-decider-hint`}
					onChange={(event) => {
						const next = event.target.value as N["decider"] | "";
						// A model belongs to its decider: the new one starts on its default.
						onChange((current) => {
							const rest = withoutField(
								withoutField(current, "model"),
								"decider",
							);
							return next === "" ? rest : { ...rest, decider: next };
						});
					}}
				>
					{named ? (
						<NativeSelectOption value="">
							{fromProfile(profile ? label(profile.decider) : "unknown")}
						</NativeSelectOption>
					) : null}
					{cannot && decider && !named ? (
						<NativeSelectOption value={decider.name} disabled>
							{decider.label}
						</NativeSelectOption>
					) : null}
					{options.map((d) => (
						<NativeSelectOption key={d.name} value={d.name}>
							{d.label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>
			<Field
				id={`${id}-model`}
				label={
					<>
						Model
						{named && node.model !== undefined ? <OverrideBadge /> : null}
					</>
				}
				optional
				hint={deciderModelHint(decider)}
			>
				<Input
					id={`${id}-model`}
					list={`${id}-models`}
					value={node.model ?? ""}
					placeholder={inherited}
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-describedby={`${id}-model-hint`}
					onChange={(event) => {
						const model = event.target.value.trim();
						onChange((current) =>
							model === ""
								? withoutField(current, "model")
								: { ...current, model },
						);
					}}
				/>
				<datalist id={`${id}-models`}>
					{models.map((value) => (
						<option key={value} value={value} />
					))}
				</datalist>
			</Field>
		</>
	);

	return (
		<InspectorSection title="Model" tab="setup">
			<Field
				id={`${id}-profile`}
				label="Profile"
				error={problem}
				hint={
					chosen
						? chosen.thisDevice
							? `This node uses ${profileOnDevice(chosen)}, this computer. Override the decider or the model for this node only.`
							: `This node runs on ${chosen.deviceName} with ${profileOnDevice(chosen)}. Open Night Shift on ${chosen.deviceName} to see or change the profile. Override the decider or the model for this node only.`
						: "A model profile of one of your computers. The node runs on that computer. Without one, pick the decider and the model below."
				}
			>
				<ProfileSelect
					id={`${id}-profile`}
					value={node.profile}
					choices={choices}
					invalid={problem !== null}
					none="None: set it on this node"
					label={(p) => `${label(p.decider)} · ${p.model ?? "default model"}`}
					onPick={(next) =>
						onChange((current) => pickProfile(current, next, profile))
					}
				/>
			</Field>
			{named ? (
				<Collapsible
					defaultOpen={overrides > 0}
					className="flex flex-col gap-4"
				>
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								size="sm"
								className="group/trigger -ml-2 w-fit text-muted-foreground"
							/>
						}
					>
						<ChevronDownIcon
							data-icon="inline-start"
							className="-rotate-90 transition-transform group-data-[panel-open]/trigger:rotate-0 motion-reduce:transition-none"
						/>
						Override for this node
						{overrides > 0 ? (
							<Badge variant="secondary" className="tabular-nums">
								{overrides}
							</Badge>
						) : null}
					</CollapsibleTrigger>
					<CollapsibleContent className="flex flex-col gap-4">
						{settings}
					</CollapsibleContent>
				</Collapsible>
			) : (
				settings
			)}
		</InspectorSection>
	);
}
