import {
	createFlowQueries,
	createProjectQueries,
	createRunMutations,
	createRunQueries,
	defaultPlacement,
	type FlowListItem,
	filledInputs,
	type InputTexts,
	jsonProblem,
	missingInputs,
	placementChoices,
} from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react-native";
import { useCallback, useState } from "react";

import { useHostQueries } from "@/features/host";
import { openRun } from "@/features/runs";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { Screen } from "@/shared/page";
import { ChoiceSelect } from "./choice-select";
import { FlowInputFields } from "./flow-input-fields";
import { PlacementField } from "./placement-field";

/** A flow file that is not valid cannot start. */
function canRun(flow: FlowListItem): boolean {
	return flow.nodeCount !== null && flow.errorCount === 0;
}

/**
 * Start a flow of the Space you chose in the header: pick a project and
 * one of its flows, fill in the flow's inputs, choose where it runs, then
 * start it and follow it live.
 */
export function StartScreen() {
	const projectQueries = useHostQueries(createProjectQueries);
	const flowQueries = useHostQueries(createFlowQueries);
	const queryClient = useQueryClient();
	const projects = useQuery(projectQueries.list());
	const [projectId, setProjectId] = useState<string | null>(null);
	const [flowName, setFlowName] = useState<string | null>(null);

	const refresh = useCallback(
		() =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: projectQueries.all() }),
				queryClient.invalidateQueries({ queryKey: flowQueries.all() }),
			]),
		[queryClient, projectQueries, flowQueries],
	);

	// A failed refresh keeps the projects it has.
	const list = projects.data;
	if (!list) {
		if (!projects.isError) {
			return (
				<Screen>
					<Skeleton className="h-40 w-full rounded-xl" />
				</Screen>
			);
		}
		return (
			<Screen onRefresh={refresh}>
				<ErrorAlert
					title="The projects did not load"
					message={projects.error?.message ?? ""}
					fix="Check that this phone is online, then try again."
					onRetry={() => void projects.refetch()}
				/>
			</Screen>
		);
	}

	if (list.length === 0) {
		return (
			<Screen onRefresh={refresh}>
				<EmptyState
					icon={FolderGit2}
					title="No projects in this Space"
					description="A flow runs on a project. Add a project in Night Shift on your computer, then start its flows here."
				/>
			</Screen>
		);
	}

	// One project: nothing to choose.
	const project =
		list.find((p) => p.id === projectId) ??
		(list.length === 1 ? list[0] : undefined);

	return (
		<Screen onRefresh={refresh}>
			<Card>
				<CardHeader>
					<CardTitle>Start a flow</CardTitle>
					<CardDescription>
						Choose a project and one of its flows. You follow the run here.
					</CardDescription>
				</CardHeader>
				<CardContent className="gap-4">
					<ChoiceSelect
						label="Project"
						placeholder="Choose a project"
						choices={list.map((p) => ({ value: p.id, label: p.name }))}
						value={project?.id ?? null}
						onChange={(id) => {
							setProjectId(id);
							setFlowName(null);
						}}
					/>
					{project ? (
						<FlowPicker
							projectId={project.id}
							value={flowName}
							onChange={setFlowName}
						/>
					) : null}
				</CardContent>
			</Card>
			{project && flowName ? (
				<StartForm
					key={`${project.id}:${flowName}`}
					projectId={project.id}
					flowName={flowName}
				/>
			) : null}
		</Screen>
	);
}

/** The flows of one project. A flow that is not valid shows, but cannot be chosen. */
function FlowPicker({
	projectId,
	value,
	onChange,
}: {
	projectId: string;
	value: string | null;
	onChange: (name: string) => void;
}) {
	const flowQueries = useHostQueries(createFlowQueries);
	const flows = useQuery(flowQueries.list(projectId));

	const list = flows.data;
	if (!list) {
		if (!flows.isError) return <Skeleton className="h-16 w-full" />;
		return (
			<ErrorAlert
				title="The flows did not load"
				message={flows.error?.message ?? ""}
				fix="Check that this phone is online, then try again."
				onRetry={() => void flows.refetch()}
			/>
		);
	}
	if (list.length === 0) {
		return (
			<Text variant="muted" className="text-muted-foreground">
				This project has no flows yet. Make one in Night Shift on your computer.
			</Text>
		);
	}
	const chosen = list.find((flow) => flow.name === value);
	return (
		<>
			<ChoiceSelect
				label="Flow"
				placeholder="Choose a flow"
				choices={list.map((flow) => ({
					value: flow.name,
					label: canRun(flow) ? flow.name : `${flow.name} (not valid)`,
					disabled: !canRun(flow),
				}))}
				value={value}
				onChange={onChange}
			/>
			{chosen?.description ? (
				<Text variant="muted" className="text-muted-foreground">
					{chosen.description}
				</Text>
			) : null}
			{list.some((flow) => !canRun(flow)) ? (
				<Text variant="muted" className="text-muted-foreground">
					A flow that is not valid cannot start. Fix it in Night Shift on your
					computer.
				</Text>
			) : null}
		</>
	);
}

/** The inputs of the flow, where it runs, and the Start button. */
function StartForm({
	projectId,
	flowName,
}: {
	projectId: string;
	flowName: string;
}) {
	const flowQueries = useHostQueries(createFlowQueries);
	const flow = useQuery(flowQueries.get(projectId, flowName));

	const loaded = flow.data;
	if (!loaded) {
		if (!flow.isError) {
			return <Skeleton className="h-48 w-full rounded-xl" />;
		}
		return (
			<ErrorAlert
				title="The flow did not load"
				message={flow.error?.message ?? ""}
				fix="Check that this phone is online, then try again."
				onRetry={() => void flow.refetch()}
			/>
		);
	}
	if (!loaded.flow) {
		return (
			<ErrorAlert
				title="This flow is not valid"
				message="It cannot start until it is fixed."
				fix="Fix it in Night Shift on your computer, then pull down to load it again."
			/>
		);
	}
	return (
		<InputsAndStart
			projectId={projectId}
			flowName={flowName}
			inputs={loaded.flow.inputs}
		/>
	);
}

function InputsAndStart({
	projectId,
	flowName,
	inputs,
}: {
	projectId: string;
	flowName: string;
	inputs: FlowInputDef[];
}) {
	const runQueries = useHostQueries(createRunQueries);
	const runMutations = useHostQueries(createRunMutations);
	const queryClient = useQueryClient();
	const [values, setValues] = useState<InputTexts>({});
	const [chosenDevice, setChosenDevice] = useState<string | null>(null);
	const placements = useQuery(runQueries.placements(projectId));
	const devices = useQuery(runQueries.devices(projectId));

	const choices = placementChoices(placements.data ?? [], devices.data ?? []);
	const place = defaultPlacement(choices, chosenDevice);
	const missing = missingInputs(inputs, values);
	const badJson = inputs.filter(
		(input) => jsonProblem(input, values[input.name]) !== null,
	);

	const start = useMutation(
		runMutations.start({
			onSuccess: (run) => {
				void queryClient.invalidateQueries({ queryKey: runQueries.all() });
				openRun(run.id);
			},
		}),
	);

	const blocker =
		missing.length > 0
			? `Fill in ${missing.map((input) => input.label || input.name).join(", ")} first.`
			: badJson.length > 0
				? `Check the format of ${badJson.map((input) => input.label || input.name).join(", ")} first.`
				: placements.data !== undefined && !place
					? "No device can take the run now."
					: null;

	return (
		<>
			{inputs.length > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle>Inputs</CardTitle>
						<CardDescription>
							What the flow works with. An empty field takes its default.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<FlowInputFields
							inputs={inputs}
							values={values}
							onChange={setValues}
						/>
					</CardContent>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Where it runs</CardTitle>
					<CardDescription>
						The steps run on the device you choose. It must be online and have
						this project.
					</CardDescription>
				</CardHeader>
				<CardContent className="gap-4">
					{placements.data === undefined && !placements.isError ? (
						<Skeleton className="h-16 w-full" />
					) : placements.data === undefined ? (
						<ErrorAlert
							title="The devices did not load"
							message={placements.error?.message ?? ""}
							fix="Check that this phone is online, then try again."
							onRetry={() => void placements.refetch()}
						/>
					) : (
						<>
							<PlacementField
								choices={choices}
								value={place?.deviceId ?? null}
								onChange={setChosenDevice}
							/>
							{!place ? (
								<ErrorAlert
									title="No device can take this run now"
									message="None of your devices with this project is online."
									fix="Open Night Shift on one of them, then pull down to check again."
								/>
							) : null}
						</>
					)}
				</CardContent>
			</Card>

			{start.error ? (
				<ErrorAlert
					title="The run did not start"
					message={start.error.message}
					fix="Check the inputs and the device, then start it again."
				/>
			) : null}

			{blocker ? (
				<Text variant="muted" className="text-center text-muted-foreground">
					{blocker}
				</Text>
			) : null}
			<Button
				size="lg"
				disabled={blocker !== null || !place || start.isPending}
				onPress={() => {
					if (!place) return;
					const filled = filledInputs(inputs, values);
					start.mutate({
						projectId,
						flowName,
						...(Object.keys(filled).length > 0 ? { inputs: filled } : {}),
						...(place.thisDevice ? {} : { deviceId: place.deviceId }),
					});
				}}
			>
				<Text>{start.isPending ? "Starting…" : "Start run"}</Text>
			</Button>
		</>
	);
}
