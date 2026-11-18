import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { InputGroupButton } from "@nightshift/ui/components/input-group";
import { ChevronDownIcon } from "lucide-react";
import { EFFORTS } from "@/features/agents";
import type { Effort } from "@/shared/api";
import type { AgentChoice } from "./agent-choice";
import type { resolve } from "./agent-options";

/** The effort radio's value for "no effort set here". */
const NO_EFFORT = ":default";

export function EffortMenu({
	choice,
	set,
	now,
}: {
	choice: AgentChoice;
	set: (choice: AgentChoice) => void;
	now: ReturnType<typeof resolve>;
}) {
	const fromProfile = !now.none && now.profile?.effort;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<InputGroupButton
						className="shrink-0 font-normal text-muted-foreground"
						disabled={now.locked}
						aria-label={`Effort: ${now.effort ?? "model default"}. Choose the effort.`}
						title="Choose how hard the agent thinks"
					>
						{now.effort ?? "Effort"}
						<ChevronDownIcon />
					</InputGroupButton>
				}
			/>
			<DropdownMenuContent align="start" className="w-48">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Effort</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={choice.effort ?? NO_EFFORT}
						onValueChange={(next: string) => {
							const effort = next === NO_EFFORT ? undefined : (next as Effort);
							// A change on the profile for help pins that profile.
							const base: AgentChoice = now.usesHelp
								? now.profile
									? { profile: now.profile.name }
									: {}
								: { ...choice };
							const { effort: _, ...rest } = base;
							set(effort ? { ...rest, effort } : rest);
						}}
					>
						<DropdownMenuRadioItem value={NO_EFFORT} closeOnClick>
							{fromProfile ? "From the profile" : "Model default"}
							{fromProfile ? (
								<DropdownMenuShortcut className="tracking-normal">
									{fromProfile}
								</DropdownMenuShortcut>
							) : null}
						</DropdownMenuRadioItem>
						{EFFORTS.map((value) => (
							<DropdownMenuRadioItem key={value} value={value} closeOnClick>
								{value}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
