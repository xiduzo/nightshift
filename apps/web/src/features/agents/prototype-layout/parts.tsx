/**
 * PROTOTYPE, throw away. The pieces the Agents page variants share: what
 * they get from the page, a profile card, the rows of harnesses and tools,
 * and the programs found on this computer as rows you set up in place.
 */
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
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
import type {
	AgentProfileRow,
	CliTool,
	Connection,
	FoundProgram,
	HarnessRow,
	ModelProfileRow,
	OtherDevice,
	ProfileRow,
	SecretView,
} from "@/shared/api";
import type { Selection } from "../agents-selection";
import { CliToolCheckBadge } from "../cli-tool";
import { CliCheckBadge } from "../connections/cli-panel";
import { harnessInfo } from "../harnesses";
import {
	cliToolQueries,
	harnessQueries,
	profileQueries,
	programMutations,
	programQueries,
} from "../queries";

export type PrototypeProps = {
	/** From the address only: nothing means the overview. */
	selection: Selection | null;
	select: (selection: Selection | null) => void;
	/** The detail of `selection`, as the page renders it today. */
	detail: ReactNode;
	agentProfiles: AgentProfileRow[];
	modelProfiles: ModelProfileRow[];
	harnesses: HarnessRow[];
	cliTools: CliTool[];
	connections: Connection[];
	secrets: SecretView[];
	missingSecrets: number;
	otherDevices: OtherDevice[];
	deciderLabel: (name: string) => string;
	onAddHarness: () => void;
	onAddTool: () => void;
};

export function usedInLabel(usedBy: ProfileRow["usedBy"]): string {
	return usedBy.length === 0
		? "Not used"
		: `In ${usedBy.length} ${usedBy.length === 1 ? "flow" : "flows"}`;
}

/** One Agent Profile as a card, like a flow on the Flows page. */
export function ProfileCard({
	profile,
	onOpen,
}: {
	profile: AgentProfileRow;
	onOpen: () => void;
}) {
	const tools = profile.clis.length + profile.connections.length;
	return (
		<Card size="sm" className="relative transition-colors hover:bg-muted/40">
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<button
						type="button"
						onClick={onOpen}
						className="truncate text-left font-mono outline-none after:absolute after:inset-0"
					>
						{profile.name}
					</button>
				</CardTitle>
				<CardDescription className="line-clamp-2">
					{profile.description ?? "No description"}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap gap-1">
				<Badge variant="secondary">{harnessInfo(profile.harness).label}</Badge>
				<Badge variant="outline">{profile.model}</Badge>
				{profile.effort ? (
					<Badge variant="outline">{profile.effort}</Badge>
				) : null}
			</CardContent>
			<CardFooter className="mt-auto justify-between border-t text-muted-foreground text-xs">
				<span>
					{tools === 0
						? "No tools"
						: `${tools} ${tools === 1 ? "tool" : "tools"}`}
				</span>
				<span title={profile.usedBy.map((u) => u.flowName).join(", ")}>
					{usedInLabel(profile.usedBy)}
				</span>
			</CardFooter>
		</Card>
	);
}

export function HarnessItem({
	harness,
	onOpen,
}: {
	harness: HarnessRow;
	onOpen: () => void;
}) {
	return (
		<Item
			variant="outline"
			size="sm"
			render={<button type="button" onClick={onOpen} />}
			className="text-left"
		>
			<ItemContent>
				<ItemTitle>{harness.label}</ItemTitle>
				{harness.custom ? (
					<ItemDescription>Custom agent</ItemDescription>
				) : null}
			</ItemContent>
			<ItemActions>
				<CliCheckBadge target={harness.name} />
			</ItemActions>
		</Item>
	);
}

export function CliToolItem({
	tool,
	onOpen,
}: {
	tool: CliTool;
	onOpen: () => void;
}) {
	return (
		<Item
			variant="outline"
			size="sm"
			render={<button type="button" onClick={onOpen} />}
			className="text-left"
		>
			<ItemContent>
				<ItemTitle className="font-mono">{tool.name}</ItemTitle>
				<ItemDescription className="line-clamp-1">
					{tool.description ?? "CLI"}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<CliToolCheckBadge name={tool.name} />
			</ItemActions>
		</Item>
	);
}

export function ConnectionItem({
	connection,
	onOpen,
}: {
	connection: Connection;
	onOpen: () => void;
}) {
	const missing = connection.variables.filter(
		(v) => v.source === "missing",
	).length;
	return (
		<Item
			variant="outline"
			size="sm"
			render={<button type="button" onClick={onOpen} />}
			className="text-left"
		>
			<ItemContent>
				<ItemTitle className="font-mono">{connection.name}</ItemTitle>
				<ItemDescription>MCP server</ItemDescription>
			</ItemContent>
			<ItemActions>
				{missing > 0 ? (
					<Badge variant="outline" className="text-status-waiting">
						Secret missing
					</Badge>
				) : null}
			</ItemActions>
		</Item>
	);
}

/**
 * The programs this computer has that are not set up yet, split into agent
 * CLIs (for Harnesses) and tools. Setting one up shows what it made.
 */
export function useFoundPrograms(onSetUp: (selection: Selection) => void) {
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
	const row = (program: FoundProgram) => (
		<FoundItem
			key={program.program}
			program={program}
			pending={setUp.isPending && setUp.variables?.program === program.program}
			disabled={setUp.isPending}
			onSetUp={() => setUp.mutate({ program: program.program })}
		/>
	);
	return {
		agents: programs.filter((p) => p.kind === "agent"),
		tools: programs.filter((p) => p.kind !== "agent"),
		row,
	};
}

/** A program that is here but not set up: dashed, with one action. */
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
				<ItemDescription>On this computer, not set up</ItemDescription>
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
					Set up
				</Button>
			</ItemActions>
		</Item>
	);
}
