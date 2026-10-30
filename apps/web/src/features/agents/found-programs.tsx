import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, SearchCheckIcon } from "lucide-react";
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
 * not set up yet, with one action each. Nothing when there are none.
 */
export function FoundPrograms({
	onSetUp,
}: {
	/** Shows what the action made: the profile or the tool. */
	onSetUp: (selection: Selection) => void;
}) {
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
	if (programs.length === 0) return null;

	return (
		<div className="mx-auto w-full max-w-6xl px-4 pt-8 md:px-8">
			<Alert>
				<SearchCheckIcon />
				<AlertTitle>Found on this computer</AlertTitle>
				<AlertDescription>
					<p>Set these up, and your flows can use them.</p>
					<ItemGroup className="mt-2 w-full gap-2">
						{programs.map((program) => (
							<FoundItem
								key={program.program}
								program={program}
								pending={
									setUp.isPending &&
									setUp.variables?.program === program.program
								}
								disabled={setUp.isPending}
								onSetUp={() => setUp.mutate({ program: program.program })}
							/>
						))}
					</ItemGroup>
				</AlertDescription>
			</Alert>
		</div>
	);
}

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
		<Item variant="outline" size="sm">
			<ItemContent>
				<ItemTitle>{program.label}</ItemTitle>
				<ItemDescription className="font-mono text-xs">
					{program.program}
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
