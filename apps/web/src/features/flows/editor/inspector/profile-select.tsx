/**
 * The profile a node names: a profile of one Device (ADR 3), shown as
 * "builder on LE2316". The list is the Devices a run of the project may
 * use, each with its profiles of the node's kind: this computer's, the
 * person's other Devices', and what other people offer to the Space. The
 * settings of a profile are known for this computer's profiles only.
 */
import {
	isProfileRef,
	type NodeProfile,
	type Profile,
	type ProfileRef,
} from "@nightshift/flows";
import {
	NativeSelect,
	NativeSelectOptGroup,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { profileQueries } from "@/features/agents";
import { runQueries } from "@/features/runs/queries";

/** A profile a node can name: the pair, its name, and its Device. */
export type ProfileChoice<P extends Profile> = {
	ref: ProfileRef;
	name: string;
	deviceName: string;
	thisDevice: boolean;
	/** Its settings: known for this computer's profiles only. */
	profile?: P;
};

const quiet = { staleTime: 30_000, meta: { quietErrors: true } } as const;

/** "builder on LE2316": how a person reads a profile of a Device. */
export function profileOnDevice(choice: {
	name: string;
	deviceName: string;
}): string {
	return `${choice.name} on ${choice.deviceName}`;
}

const keyOf = (ref: ProfileRef) => `${ref.device}\u001f${ref.profile}`;

/** An old profile's id is its name: what a node shows when its profile is gone. */
const idAsName = (ref: ProfileRef) =>
	/^[a-z][a-z0-9_]{0,39}$/.test(ref.profile) ? ref.profile : null;

/** The profiles of one kind a node can name, the one it names, and what is wrong with it. */
function useProfileChoices<P extends Profile & { id: string }>(
	projectId: string,
	kind: "agent" | "model",
	own: readonly P[] | undefined,
	value: NodeProfile | undefined,
) {
	const devices = useQuery({ ...runQueries.devices(projectId), ...quiet });
	const choices: ProfileChoice<P>[] = (devices.data ?? []).flatMap((device) =>
		(device.profiles ?? [])
			.filter((profile) => profile.kind === kind)
			.map((profile) => {
				const settings = device.thisDevice
					? own?.find((mine) => mine.id === profile.id)
					: undefined;
				return {
					ref: { device: device.deviceId, profile: profile.id },
					name: profile.name,
					deviceName: device.name,
					thisDevice: device.thisDevice,
					...(settings ? { profile: settings } : {}),
				};
			}),
	);
	const ref = isProfileRef(value) ? value : undefined;
	const chosen =
		ref === undefined
			? undefined
			: choices.find((choice) => keyOf(choice.ref) === keyOf(ref));
	const device = devices.data?.find((d) => d.deviceId === ref?.device);
	// A Device whose profiles this computer cannot tell: its node is not marked.
	const untold = device !== undefined && device.profiles === undefined;
	return {
		choices,
		chosen,
		/** A name left from format 6: the person picks the profile again. */
		stale: typeof value === "string" ? value : undefined,
		/** The node names a profile its Device does not have, or a Device the Space does not. */
		unknown:
			ref !== undefined && devices.data !== undefined && !chosen && !untold,
		/** The Device the node's profile names, by its name, when the list has it. */
		deviceName: device?.name,
	};
}

/** The Agent Profiles an Agent node can name, and the one it names. */
export function useAgentProfiles(
	projectId: string,
	value: NodeProfile | undefined,
) {
	const own = useQuery({ ...profileQueries.agents(), ...quiet });
	return useProfileChoices(projectId, "agent", own.data, value);
}

/** The Model Profiles a Decision or a Value by a model can name, and the one it names. */
export function useModelProfiles(
	projectId: string,
	value: NodeProfile | undefined,
) {
	const own = useQuery({ ...profileQueries.models(), ...quiet });
	return useProfileChoices(projectId, "model", own.data, value);
}

/**
 * Why the node's profile does not run, or null: a name left from format 6,
 * or a profile its Device does not have.
 */
export function profileProblem(found: {
	stale: string | undefined;
	unknown: boolean;
	deviceName: string | undefined;
}): string | null {
	if (found.stale !== undefined) {
		return `Pick the profile again. This node names "${found.stale}", but not the computer it is on.`;
	}
	if (!found.unknown) return null;
	return found.deviceName
		? `${found.deviceName} no longer has this profile. The flow cannot run until you pick another profile.`
		: "The computer of this profile is no longer in this Space. The flow cannot run until you pick another profile.";
}

/** A picker of profiles: none, then each Device's, this computer first. */
export function ProfileSelect<P extends Profile>({
	id,
	value,
	choices,
	invalid,
	none,
	label,
	onPick,
}: {
	id: string;
	value: NodeProfile | undefined;
	choices: ProfileChoice<P>[];
	/** The node's profile does not run: `profileProblem` says why. */
	invalid: boolean;
	/** The option for no profile. */
	none: string;
	/** How a profile of this computer reads in the list, after its name. */
	label: (profile: P) => string;
	onPick: (choice: ProfileChoice<P> | undefined) => void;
}) {
	const groups = new Map<string, ProfileChoice<P>[]>();
	for (const choice of [...choices].sort(
		(a, b) => Number(b.thisDevice) - Number(a.thisDevice),
	)) {
		const group = groups.get(choice.ref.device) ?? [];
		group.push(choice);
		groups.set(choice.ref.device, group);
	}
	const current =
		value === undefined
			? ""
			: isProfileRef(value)
				? keyOf(value)
				: `stale\u001f${value}`;
	const listed = choices.some((choice) => keyOf(choice.ref) === current);
	return (
		<NativeSelect
			id={id}
			value={current}
			aria-describedby={`${id}-hint`}
			aria-invalid={invalid || undefined}
			onChange={(event) => {
				const key = event.target.value;
				onPick(choices.find((choice) => keyOf(choice.ref) === key));
			}}
		>
			<NativeSelectOption value="">{none}</NativeSelectOption>
			{[...groups.values()].map((group) => {
				const [first] = group as [ProfileChoice<P>];
				return (
					<NativeSelectOptGroup
						key={first.ref.device}
						label={
							first.thisDevice
								? `On ${first.deviceName} (this computer)`
								: `On ${first.deviceName}`
						}
					>
						{group.map((choice) => (
							<NativeSelectOption
								key={keyOf(choice.ref)}
								value={keyOf(choice.ref)}
							>
								{choice.profile
									? `${choice.name} · ${label(choice.profile)}`
									: choice.name}
							</NativeSelectOption>
						))}
					</NativeSelectOptGroup>
				);
			})}
			{value !== undefined && current !== "" && !listed ? (
				<NativeSelectOption value={current}>
					{isProfileRef(value)
						? `${idAsName(value) ?? "A profile"} (not found)`
						: `${value} (pick again)`}
				</NativeSelectOption>
			) : null}
		</NativeSelect>
	);
}
