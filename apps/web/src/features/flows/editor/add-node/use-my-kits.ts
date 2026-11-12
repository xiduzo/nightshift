import {
	type Flow,
	type ProjectFlowMap,
	suffixedName,
} from "@nightshift/flows";
import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { projectQueries } from "@/features/projects";
import { spaceQueries } from "@/features/spaces";
import { flowMutations, flowQueries } from "../../queries";
import { myKitEntries, type OtherProject } from "./my-kits";

/** The other projects' flows change rarely while the dialog is open. */
const STALE_MS = 30_000;

/**
 * "My kits" of the add-node dialog (`myKitEntries`). The other projects'
 * flows are read only while the dialog is open. A viewer cannot copy a
 * flow into this project, so a viewer sees this project's flows only.
 */
export function useMyKits({
	projectId,
	flowName,
	flows,
	draft,
	open,
}: {
	projectId: string;
	flowName: string;
	/** This project's other flows. Undefined while they load. */
	flows: ProjectFlowMap | undefined;
	draft: Flow;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const spaces = useQuery(spaceQueries.list());
	const role = spaces.data?.spaces.find(
		(space) => space.id === spaces.data?.active,
	)?.role;
	const canCopy = role !== undefined && role !== "viewer";
	const projects = useQuery(projectQueries.list());
	const others = canCopy
		? (projects.data ?? []).filter((project) => project.id !== projectId)
		: [];
	const maps = useQueries({
		queries: others.map((project) => ({
			...flowQueries.map(project.id),
			enabled: open,
			staleTime: STALE_MS,
			refetchOnWindowFocus: false,
			meta: { quietErrors: true },
		})),
	});
	const copy = useMutation(flowMutations.copy());

	const entries = open
		? myKitEntries({
				flowName,
				draft,
				flows,
				others: others.flatMap((project, index): OtherProject[] => {
					const theirs = maps[index]?.data;
					return theirs
						? [{ projectId: project.id, project: project.name, flows: theirs }]
						: [];
				}),
			})
		: [];

	/**
	 * Copies `flow` of another project into this one, under its own name or
	 * the first free one after it. Gives the name here, or null when it
	 * could not.
	 */
	const copyHere = async (
		flow: string,
		from: { projectId: string; project: string },
	): Promise<string | null> => {
		const taken = new Set([...Object.keys(flows ?? {}), flowName]);
		const as = suffixedName(flow, taken);
		try {
			const saved = await copy.mutateAsync({
				projectId: from.projectId,
				name: flow,
				toProjectId: projectId,
				as,
			});
			// The new flow must be in the map before the node names it.
			await queryClient.invalidateQueries({
				queryKey: flowQueries.map(projectId).queryKey,
			});
			const copied = `Copied ${flow} from ${from.project}${saved.name === flow ? "" : ` as ${saved.name}`}.`;
			const errors = saved.issues.filter(
				(issue) => issue.severity === "error",
			).length;
			if (errors > 0) {
				toast.warning(
					`${copied} Fix its ${errors} ${errors === 1 ? "error" : "errors"} before you run it.`,
				);
			} else {
				toast.success(copied);
			}
			return saved.name;
		} catch (error) {
			toast.error(
				`Could not copy ${flow} from ${from.project}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
	};

	return { entries, copyHere };
}
