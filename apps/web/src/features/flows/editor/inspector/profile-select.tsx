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
import { Button } from "@nightshift/ui/components/button";
import {
	NativeSelect,
	NativeSelectOptGroup,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { profileQueries } from "@/features/agents";
import { runQueries } from "@/features/runs/flows-port";
import { Field } from "../fields";

/** A profile a node can name: the pair, its name, and its Device. */
export type ProfileChoice<P extends Profile> = {
	ref: ProfileRef;
	name: string;
	deviceName: string;
	thisDevice: boolean;
	/** A development install: not offered as a backup, except on itself. */
	dev: boolean;
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
					dev: device.dev === true,
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

/** A node's backups once its profile is `next`: never the profile itself. */
export function backupsWithProfile(
	fallbacks: readonly ProfileRef[] | undefined,
	next: ProfileRef,
): ProfileRef[] | undefined {
	const kept = (fallbacks ?? []).filter(
		(backup) => keyOf(backup) !== keyOf(next),
	);
	return kept.length > 0 ? kept : undefined;
}

/**
 * The profiles that take a node's step when its own profile's computer
 * cannot, first one first (ADR 19). Each row is a profile on one computer.
 */
export function ProfileBackupsField<P extends Profile>({
	id,
	profile,
	fallbacks,
	choices,
	onChange,
}: {
	id: string;
	profile: ProfileRef;
	fallbacks: readonly ProfileRef[] | undefined;
	choices: ProfileChoice<P>[];
	onChange: (fallbacks: ProfileRef[] | undefined) => void;
}) {
	const chosen = fallbacks ?? [];
	const taken = new Set([keyOf(profile), ...chosen.map(keyOf)]);
	const open = choices.filter(
		(choice) =>
			!taken.has(keyOf(choice.ref)) && (!choice.dev || choice.thisDevice),
	);
	const set = (next: ProfileRef[]) =>
		onChange(next.length > 0 ? next : undefined);
	const missing = chosen.some(
		(backup) => !choices.some((c) => keyOf(c.ref) === keyOf(backup)),
	);
	return (
		<Field
			id={id}
			label="Backups"
			optional
			hint="The first backup that can run takes the step when this profile's computer cannot. Empty: the step waits for that computer."
			error={
				missing
					? "A backup is no longer available. Remove it, or pick another profile."
					: null
			}
		>
			<div className="flex flex-col gap-2">
				{chosen.map((backup, index) => {
					const own = choices.find((c) => keyOf(c.ref) === keyOf(backup));
					const name = own ? profileOnDevice(own) : "A profile";
					return (
						<div key={keyOf(backup)} className="flex items-center gap-2">
							<NativeSelect
								aria-label={`Backup ${index + 1}`}
								className="w-full"
								value={keyOf(backup)}
								onChange={(event) => {
									const next = choices.find(
										(c) => keyOf(c.ref) === event.target.value,
									);
									if (!next) return;
									set(chosen.map((b, i) => (i === index ? next.ref : b)));
								}}
							>
								<NativeSelectOption value={keyOf(backup)}>
									{own ? name : `${name} (not found)`}
								</NativeSelectOption>
								{open.map((choice) => (
									<NativeSelectOption
										key={keyOf(choice.ref)}
										value={keyOf(choice.ref)}
									>
										{profileOnDevice(choice)}
									</NativeSelectOption>
								))}
							</NativeSelect>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={`Remove ${name}`}
								onClick={() => set(chosen.filter((_, i) => i !== index))}
							>
								<XIcon aria-hidden="true" />
							</Button>
						</div>
					);
				})}
				{open[0] ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
						onClick={() => {
							const [first] = open;
							if (first) set([...chosen, first.ref]);
						}}
					>
						<PlusIcon data-icon="inline-start" />
						Add backup
					</Button>
				) : null}
			</div>
		</Field>
	);
}
