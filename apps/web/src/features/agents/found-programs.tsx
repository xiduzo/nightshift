import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { FoundProgram } from "@/shared/api";
import type { Selection } from "./agents-selection";
import {
	cliToolQueries,
	harnessQueries,
	profileQueries,
	programMutations,
	programQueries,
} from "./queries";

/**
 * The agent CLIs and the kits' tools that this computer has and that are
 * not set up yet, split by the list they join: agent CLIs under Harnesses,
 * tools under Tools. `row` draws one, with its Set up action.
 */
export function useFoundPrograms(
	/** Shows what the action made: the profile or the tool. */
	onSetUp: (selection: Selection) => void,
): {
	agents: FoundProgram[];
	tools: FoundProgram[];
	row: (program: FoundProgram) => ReactNode;
} {
	const queryClient = useQueryClient();
	const found = useQuery(programQueries.found());
	const setUp = useMutation(
		programMutations.setUp({
			onSuccess: (made) => {
				for (const queryKey of [
					programQueries.all(),
					profileQueries.all(),
					harnessQueries.all(),
					cliToolQueries.lists(),
				]) {
					void queryClient.invalidateQueries({ queryKey });
				}
				if (made.kind === "agent") {
					toast.success(`Added the profile ${made.name}`);
					onSetUp({ kind: "profile", id: made.profileId });
				} else {
					toast.success(`Added the tool ${made.name}`);
					onSetUp({ kind: "cli", name: made.name });
				}
			},
			onError: (error) => toast.error(`Not added: ${error.message}`),
		}),
	);

	const programs = found.data ?? [];
	return {
		agents: programs.filter((program) => program.kind === "agent"),
		tools: programs.filter((program) => program.kind !== "agent"),
		row: (program) => (
			<FoundItem
				key={program.program}
				program={program}
				pending={
					setUp.isPending && setUp.variables?.program === program.program
				}
				disabled={setUp.isPending}
				onSetUp={() => setUp.mutate({ program: program.program })}
			/>
		),
	};
}

/** A program that is here but not used yet: a dashed row with one action. */
function FoundItem({
	program,
	pending,
	disabled,
	onSetUp,
}: {
	program: FoundProgram;
	pending: boolean;
	disabled: boolean;
	onSetUp: () => void;
}) {
	return (
		<Item variant="outline" size="sm" className="border-dashed">
			<ItemContent>
				<ItemTitle className="text-muted-foreground">{program.label}</ItemTitle>
				<ItemDescription>
					{program.kind === "agent"
						? "On this computer, no profile uses it yet"
						: "On this computer, not added yet"}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button
					size="sm"
					variant="outline"
					disabled={disabled}
					onClick={onSetUp}
				>
					{pending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<PlusIcon data-icon="inline-start" />
					)}
					{program.kind === "agent" ? "Add profile" : "Add tool"}
				</Button>
			</ItemActions>
		</Item>
	);
}
