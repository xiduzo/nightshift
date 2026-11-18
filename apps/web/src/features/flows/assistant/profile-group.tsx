import {
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuShortcut,
} from "@nightshift/ui/components/dropdown-menu";
import type { AgentChoice } from "./agent-choice";
import type {
	AgentPurpose,
	DefaultAnswer,
	Options,
	resolve,
} from "./agent-options";

/** The profile radio's value for the profile for help, and for no profile. Profile names cannot hold a colon. */
const HELP = ":help";
const NONE = ":none";

export function ProfileGroup({
	choice,
	set,
	purpose,
	options,
	now,
	off = false,
	fallback,
}: {
	/** A model answers: no profile is the picked one. */
	off?: boolean;
	fallback?: DefaultAnswer | undefined;
	choice: AgentChoice;
	set: (choice: AgentChoice) => void;
	purpose: AgentPurpose;
	options: Options;
	now: ReturnType<typeof resolve>;
}) {
	const { profiles, forHelp, fits, info } = options;
	const value = fallback?.active
		? HELP
		: off
			? ""
			: now.usesHelp
				? HELP
				: now.none
					? NONE
					: (choice.profile ?? "");
	const unknown =
		choice.profile !== undefined &&
		!profiles.some((p) => p.name === choice.profile);
	return (
		<DropdownMenuGroup>
			<DropdownMenuLabel>Profile</DropdownMenuLabel>
			<DropdownMenuRadioGroup
				value={value}
				onValueChange={(next: string) => {
					if (next === HELP && fallback) fallback.onPick();
					else if (next === HELP) set({});
					else if (next === NONE)
						// Keep what the profile gave, so the same agent answers.
						set({
							harness: now.harness,
							model: now.model || info(now.harness).defaultModel,
							...(now.effort ? { effort: now.effort } : {}),
						});
					else set({ profile: next });
				}}
			>
				{fallback ? (
					<DropdownMenuRadioItem value={HELP} closeOnClick>
						<span className="truncate">Default</span>
						<DropdownMenuShortcut className="truncate tracking-normal">
							{fallback.label}
						</DropdownMenuShortcut>
					</DropdownMenuRadioItem>
				) : purpose === "run" ? null : (
					<DropdownMenuRadioItem value={HELP} closeOnClick>
						<span className="truncate">Profile for help</span>
						<DropdownMenuShortcut className="tracking-normal">
							{forHelp ? forHelp.name : "none yet"}
						</DropdownMenuShortcut>
					</DropdownMenuRadioItem>
				)}
				{profiles.map((p) => (
					<DropdownMenuRadioItem
						key={p.name}
						value={p.name}
						closeOnClick
						disabled={purpose === "chat" && !fits(p.harness)}
					>
						<span className="truncate">{p.name}</span>
						<DropdownMenuShortcut className="truncate tracking-normal">
							{info(p.harness).label} · {p.model}
							{purpose === "chat" && !fits(p.harness) ? " (cannot chat)" : ""}
						</DropdownMenuShortcut>
					</DropdownMenuRadioItem>
				))}
				{unknown ? (
					<DropdownMenuRadioItem value={choice.profile ?? ""} closeOnClick>
						{choice.profile} (not found)
					</DropdownMenuRadioItem>
				) : null}
				<DropdownMenuRadioItem value={NONE} closeOnClick>
					No profile: choose a model below
				</DropdownMenuRadioItem>
			</DropdownMenuRadioGroup>
			{now.locked ? (
				<DropdownMenuLabel className="font-normal">
					Add a profile under Your agents in Settings, or choose a model below.
				</DropdownMenuLabel>
			) : null}
		</DropdownMenuGroup>
	);
}
