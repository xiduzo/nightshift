/**
 * The profile a node names: one of this computer (the Agents page) or one
 * of the project (`.nightshift/profiles.json`). A computer's profile wins
 * over the project's of the same name, as when a run starts.
 */
import type { AgentProfile, ModelProfile, Profile } from "@nightshift/flows";
import {
	NativeSelect,
	NativeSelectOptGroup,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { profileQueries } from "@/features/agents";

/** A profile a node can name, and where it comes from. */
export type ProfileChoice<P extends Profile> = {
	profile: P;
	from: "computer" | "project";
};

const quiet = { staleTime: 30_000, meta: { quietErrors: true } } as const;

/** The profiles of the project's file of one kind, without those this computer overrides. */
function useProjectProfiles<P extends Profile>(
	projectId: string,
	fits: (profile: Profile) => profile is P,
) {
	const project = useQuery({ ...profileQueries.project(projectId), ...quiet });
	return {
		profiles: (project.data?.profiles ?? []).flatMap((p) =>
			!p.overridden && fits(p) ? [p] : [],
		),
		loaded: project.data !== undefined || project.isError,
	};
}

const isAgent = (p: Profile): p is AgentProfile => "harness" in p;
const isModel = (p: Profile): p is ModelProfile => "decider" in p;

function choicesOf<P extends Profile>(
	mine: readonly P[] | undefined,
	theirs: readonly P[],
	loaded: boolean,
	name: string | undefined,
) {
	const choices: ProfileChoice<P>[] = [
		...(mine ?? []).map((profile) => ({ profile, from: "computer" as const })),
		...theirs.map((profile) => ({ profile, from: "project" as const })),
	];
	const chosen =
		name === undefined
			? undefined
			: choices.find((choice) => choice.profile.name === name);
	return {
		choices,
		chosen,
		/** The node names a profile that neither has. */
		unknown: name !== undefined && mine !== undefined && loaded && !chosen,
	};
}

/** The Agent Profiles an Agent node can name, and the one it names. */
export function useAgentProfiles(projectId: string, name: string | undefined) {
	const computer = useQuery({ ...profileQueries.agents(), ...quiet });
	const project = useProjectProfiles(projectId, isAgent);
	return choicesOf<AgentProfile>(
		computer.data,
		project.profiles,
		project.loaded,
		name,
	);
}

/** The Model Profiles a Decision or a Value by a model can name, and the one it names. */
export function useModelProfiles(projectId: string, name: string | undefined) {
	const computer = useQuery({ ...profileQueries.models(), ...quiet });
	const project = useProjectProfiles(projectId, isModel);
	return choicesOf<ModelProfile>(
		computer.data,
		project.profiles,
		project.loaded,
		name,
	);
}

/** A picker of profiles: none, this computer's, then the project's. */
export function ProfileSelect<P extends Profile>({
	id,
	value,
	choices,
	unknown,
	none,
	label,
	onPick,
}: {
	id: string;
	value: string | undefined;
	choices: ProfileChoice<P>[];
	unknown: boolean;
	/** The option for no profile. */
	none: string;
	/** How a profile reads in the list, after its name. */
	label: (profile: P) => string;
	onPick: (choice: ProfileChoice<P> | undefined) => void;
}) {
	const group = (from: ProfileChoice<P>["from"]) =>
		choices
			.filter((choice) => choice.from === from)
			.map(({ profile }) => (
				<NativeSelectOption
					key={`${from}:${profile.name}`}
					value={profile.name}
				>
					{profile.name} · {label(profile)}
				</NativeSelectOption>
			));
	const project = group("project");
	return (
		<NativeSelect
			id={id}
			value={value ?? ""}
			aria-describedby={`${id}-hint`}
			aria-invalid={unknown || undefined}
			onChange={(event) => {
				const name = event.target.value;
				onPick(choices.find((choice) => choice.profile.name === name));
			}}
		>
			<NativeSelectOption value="">{none}</NativeSelectOption>
			<NativeSelectOptGroup label="On this computer">
				{group("computer")}
			</NativeSelectOptGroup>
			{project.length > 0 ? (
				<NativeSelectOptGroup label="In this project">
					{project}
				</NativeSelectOptGroup>
			) : null}
			{unknown && value !== undefined ? (
				<NativeSelectOption value={value}>
					{value} (not found)
				</NativeSelectOption>
			) : null}
		</NativeSelect>
	);
}
