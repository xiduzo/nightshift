import {
	canStart,
	createFlowQueries,
	createProjectQueries,
	createRunQueries,
	defaultPlacement,
	filledInputs,
	type InputTexts,
	inputProblem,
	missingInputs,
	type Project,
	placementChoices,
	useRunActed,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { FolderGit2, Play } from "lucide-react-native";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { canFollowOnLockScreen, useFollowAfterStart } from "@/features/glance";
import { useHostQueries, useSignedIn } from "@/features/host";
import { openRun } from "@/features/runs";
import { Chip, ChipRail } from "@/shared/chips";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { ListGroup, SectionHead, SwitchRow } from "@/shared/list";
import { Screen } from "@/shared/page";
import { FlowInputFields } from "./flow-input-fields";
import { PlacementField } from "./placement-field";
import { RadioRows } from "./radio-rows";
import {
	chosenFlow,
	flowCaption,
	phoneInputs,
	readsFlowFile,
	startBlocker,
} from "./start-words";

/**
 * New run, in the Space you chose in the header: pick a project and one
 * of its flows, fill in the inputs it cannot start without, choose where
 * it runs, then start it and follow it live. `projectId` chooses the
 * project first (from a project page).
 */
export function StartScreen({ projectId }: { projectId?: string }) {
	const projectQueries = useHostQueries(createProjectQueries);
	const flowQueries = useHostQueries(createFlowQueries);
	const queryClient = useQueryClient();
	const projects = useQuery(projectQueries.list());
	const [chosenProject, setChosenProject] = useState<string | null>(
		projectId ?? null,
	);

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
					description="Add a project in Night Shift on your computer. Then start its flows here."
				/>
			</Screen>
		);
	}

	// One project: nothing to choose.
	const project =
		list.find((p) => p.id === chosenProject) ??
		(list.length === 1 ? list[0] : undefined);

	return (
		<NewRun
			// Another project starts a new form.
			key={project?.id ?? "none"}
			projects={list}
			project={project}
			onProject={setChosenProject}
			onRefresh={refresh}
		/>
	);
}

/**
 * The form of one project: the projects as chips, its flows, the inputs
 * the run needs, where it runs, Follow on the lock screen, and Start run.
 */
function NewRun({
	projects,
	project,
	onProject,
	onRefresh,
}: {
	projects: Project[];
	project: Project | undefined;
	onProject: (projectId: string) => void;
	onRefresh: () => Promise<unknown>;
}) {
	const flowQueries = useHostQueries(createFlowQueries);
	const runQueries = useHostQueries(createRunQueries);
	const { host } = useSignedIn();
	const runActed = useRunActed(host);
	const projectId = project?.id ?? "";
	const [flowName, setFlowName] = useState<string | null>(null);
	const [values, setValues] = useState<InputTexts>({});
	const [chosenDevice, setChosenDevice] = useState<string | null>(null);
	const [followOnLockScreen, setFollowOnLockScreen] = useState(false);
	const followAfterStart = useFollowAfterStart();

	const flows = useQuery({
		...flowQueries.list(projectId),
		enabled: project !== undefined,
	});
	const listed = flows.data?.find((item) => item.name === flowName);
	const flow = useQuery({
		...flowQueries.get(projectId, flowName ?? ""),
		enabled:
			project !== undefined && flowName !== null && readsFlowFile(listed),
	});
	const placements = useQuery({
		...runQueries.placements(projectId),
		enabled: project !== undefined,
	});
	const devices = useQuery({
		...runQueries.devices(projectId),
		enabled: project !== undefined,
	});

	const chosen = chosenFlow(listed, flow.data);
	const inputs = chosen?.inputs ?? [];
	const { needed, more } = phoneInputs(inputs);
	const choices = placementChoices(placements.data ?? [], devices.data ?? []);
	const place = defaultPlacement(choices, chosenDevice);
	const badJson = needed.filter(
		(input) => inputProblem(input, values[input.name]) !== null,
	);
	const blocker = startBlocker({
		flowChosen: flowName !== null,
		missing: missingInputs(inputs, values),
		badJson,
		placementsLoaded: placements.data !== undefined,
		hasPlace: place !== null,
	});

	const start = useMutation(
		host.orpc.runs.start.mutationOptions({
			onSuccess: (run) => {
				runActed(run.id);
				if (followOnLockScreen) void followAfterStart(run.id);
				// Close New run, then follow the run on the main screens.
				if (router.canDismiss()) router.dismiss();
				openRun(run.id);
			},
		}),
	);

	const ready =
		flowName !== null && chosen?.valid === true && blocker === null && place;

	function startRun() {
		if (!project || !flowName || !place) return;
		const filled = filledInputs(needed, values);
		start.mutate({
			projectId: project.id,
			flowName,
			...(Object.keys(filled).length > 0 ? { inputs: filled } : {}),
			...(place.thisDevice ? {} : { deviceId: place.deviceId }),
		});
	}

	return (
		<Screen
			onRefresh={onRefresh}
			footer={
				<View className="gap-2">
					<Button
						size="lg"
						disabled={!ready || start.isPending}
						onPress={startRun}
						className="h-auto min-h-11 w-full py-2"
					>
						<Icon as={Play} />
						<Text>{start.isPending ? "Starting…" : "Start run"}</Text>
					</Button>
					{blocker ? (
						<Text variant="muted" className="text-center text-muted-foreground">
							{blocker}
						</Text>
					) : null}
				</View>
			}
		>
			{projects.length > 1 ? (
				<View className="gap-3">
					<SectionHead title="Project" />
					<ChipRail>
						{projects.map((p) => (
							<Chip
								key={p.id}
								label={p.name}
								selected={p.id === project?.id}
								onPress={() => onProject(p.id)}
							/>
						))}
					</ChipRail>
				</View>
			) : null}

			{project ? (
				<View className="gap-3">
					<SectionHead
						title="Flow"
						hint={
							projects.length === 1
								? `The flows of ${project.name}.`
								: undefined
						}
					/>
					{flows.data ? (
						flows.data.length === 0 ? (
							<Line text="This project has no flows yet. Make one in Night Shift on your computer." />
						) : (
							<RadioRows
								label="Flow"
								choices={flows.data.map((item) => ({
									value: item.name,
									title: item.name,
									caption: flowCaption(item),
									disabled: !canStart(item),
								}))}
								value={flowName}
								onChange={(name) => {
									setFlowName(name);
									setValues({});
								}}
							/>
						)
					) : flows.isError ? (
						<ErrorAlert
							title="The flows did not load"
							message={flows.error.message}
							fix="Check that this phone is online, then try again."
							onRetry={() => void flows.refetch()}
						/>
					) : (
						<Skeleton className="h-32 w-full rounded-xl" />
					)}
					{chosen?.valid && more ? (
						<Text variant="muted" className="text-muted-foreground">
							{needed.length > 0
								? "The other inputs use their defaults. To change them, start the run on the desktop."
								: "Inputs use their defaults. To change them, start the run on the desktop."}
						</Text>
					) : null}
				</View>
			) : null}

			{project && flowName ? (
				chosen ? (
					chosen.valid ? (
						needed.length > 0 ? (
							<View className="gap-3">
								<SectionHead title="Inputs" />
								<Card className="py-4">
									<CardContent className="px-4">
										<FlowInputFields
											inputs={needed}
											values={values}
											onChange={setValues}
										/>
									</CardContent>
								</Card>
							</View>
						) : null
					) : (
						<ErrorAlert
							title="This flow is not valid"
							message="It cannot start like this."
							fix="Fix it in Night Shift on your computer. Then pull down to load it again."
						/>
					)
				) : flow.isError ? (
					<ErrorAlert
						title="The flow did not load"
						message={flow.error.message}
						fix="Check that this phone is online, then try again."
						onRetry={() => void flow.refetch()}
					/>
				) : (
					<Skeleton className="h-32 w-full rounded-xl" />
				)
			) : null}

			{project ? (
				<View className="gap-3">
					<SectionHead title="Where it runs" />
					{placements.data === undefined && !placements.isError ? (
						<Skeleton className="h-16 w-full rounded-xl" />
					) : placements.data === undefined ? (
						<ErrorAlert
							title="The computers did not load"
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
									title="No computer can take this run now"
									message="None of your computers with this project is online."
									fix="Open Night Shift on one of them, then pull down to check again."
								/>
							) : null}
						</>
					)}
				</View>
			) : null}

			{project && canFollowOnLockScreen ? (
				<ListGroup>
					<SwitchRow
						title="Follow on the lock screen"
						caption="See its step and time without opening the app."
						checked={followOnLockScreen}
						onChange={setFollowOnLockScreen}
					/>
				</ListGroup>
			) : null}

			{start.error ? (
				<ErrorAlert
					title="The run did not start"
					message={start.error.message}
					fix="Check the inputs and the computer, then start it again."
				/>
			) : null}
		</Screen>
	);
}

/** One muted line in a Card: a list with nothing in it. */
function Line({ text }: { text: string }) {
	return (
		<Card className="py-4">
			<CardContent className="px-4">
				<Text className="text-muted-foreground text-sm">{text}</Text>
			</CardContent>
		</Card>
	);
}
