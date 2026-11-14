import {
	type Artifact,
	createRunQueries,
	deadlineSoon,
	type OpenGate,
	type RunDetail,
	type RunStatus,
	type StepChanges,
	type StepSummary,
	stepChangedFiles,
} from "@nightshift/client";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
	FileDiff,
	FileText,
	GitPullRequest,
	Link2,
	Share as ShareIcon,
	SquareTerminal,
} from "lucide-react-native";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { gateRowText } from "@/features/inbox";
import { useClock } from "@/shared/clock";
import {
	NativeButtonRow,
	NativeCustomRow,
	NativeRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { useWhileFocused } from "@/shared/refresh";
import { useThemeColors } from "@/shared/theme";
import { gateLook } from "@/shared/tone";
import { trailItemLabel, trailItemOf } from "@/shared/trail";
import { nativeLook } from "./native-looks";
import {
	changesSummary,
	linkCaption,
	linkLook,
	type RunFact,
	type RunLink,
	sizeLabel,
} from "./run-facts";

/**
 * The sections of the run screen as native list sections. Each draws
 * only what the screen hands it: the screen decides what shows.
 */

/** Opens one Gate of the run to answer it. */
export function openGate(runId: string, stepId: string): void {
	router.push({
		pathname: "/gates/[runId]/[stepId]",
		params: { runId, stepId },
	});
}

/** The open Gates of this run: a row each opens it. Their times keep current. */
export function GatesSection({ gates }: { gates: readonly OpenGate[] }) {
	const now = useClock();
	const { colors } = useThemeColors();
	return (
		<NativeSection
			title={gates.length === 1 ? "Gate" : `Gates · ${gates.length} wait`}
		>
			{gates.map((gate) => {
				const look = gateLook(gate);
				const row = gateRowText(gate, now);
				// A deadline in the next hour comes first: "Picks keep in 12 min".
				const soon = deadlineSoon(gate.deadline, now, gate.form);
				return (
					<NativeRow
						key={gate.stepId}
						{...nativeLook(look, colors)}
						overline={soon ?? undefined}
						title={row.title}
						subtitle={row.situation || `${look.label} · ${row.choices}`}
						value={row.due ?? row.waited}
						onPress={() => openGate(gate.runId, gate.stepId)}
					/>
				);
			})}
		</NativeSection>
	);
}

/** What a step that talks says now: its newest agent message, short. */
export function NowSection({
	step,
	message,
}: {
	step: string;
	message: string | null;
}) {
	return (
		<NativeSection title={`Now · ${step}`}>
			{message ? (
				<NativeTextRow text={message} />
			) : (
				<NativeTextRow text="No message from this step yet." secondary />
			)}
		</NativeSection>
	);
}

/** What the run cost: cost, tokens and how long it ran, one row each. */
export function CostSection({ facts }: { facts: readonly RunFact[] }) {
	return (
		<NativeSection title="What it cost">
			{facts.map((fact) => (
				<NativeRow
					key={fact.label}
					title={fact.label}
					subtitle={fact.sub}
					value={fact.value}
				/>
			))}
		</NativeSection>
	);
}

/** Opens the files a run changed. */
export function openChanges(runId: string): void {
	router.push({ pathname: "/changes/[runId]", params: { runId } });
}

/**
 * What the run changed and made: a row that opens its changed files, a
 * row per link of its items (a pull request opens on GitHub), and the
 * files its agents kept.
 */
export function ChangesSection({
	run,
	ended,
	links,
	changes,
	stepIds,
	connecting,
}: {
	run: RunDetail;
	ended: boolean;
	links: readonly RunLink[];
	changes: StepChanges;
	stepIds: string[];
	/** The changes load still: no row says "none" yet. */
	connecting: boolean;
}) {
	const runQueries = useHostQueries(createRunQueries);
	const artifacts = useQuery({
		...runQueries.artifacts(run.id, !ended),
		...useWhileFocused(),
	});
	const files: Artifact[] = artifacts.data ?? [];
	const groups = stepChangedFiles(changes, stepIds);
	const icon = { sf: "doc.on.doc" as const, lucide: FileDiff };

	return (
		<NativeSection title="What it changed">
			{groups.length > 0 ? (
				<NativeRow
					icon={icon}
					title="Changed files"
					subtitle={changesSummary(groups)}
					onPress={() => openChanges(run.id)}
				/>
			) : connecting ? (
				<NativeRow
					icon={icon}
					title="Changed files"
					subtitle="Loading…"
					muted
				/>
			) : (
				<NativeRow
					icon={icon}
					title={ended ? "No files changed" : "No files changed yet"}
					muted
				/>
			)}
			{links.map((link) => {
				const look = linkLook(link.url);
				return (
					<NativeRow
						key={link.url}
						icon={
							look.pullRequest
								? { sf: "arrow.triangle.pull", lucide: GitPullRequest }
								: { sf: "link", lucide: Link2 }
						}
						title={link.title}
						subtitle={linkCaption(look).join(" · ")}
						onPress={() => void WebBrowser.openBrowserAsync(link.url)}
					/>
				);
			})}
			{files.map((file) => (
				<NativeRow
					key={file.id}
					icon={{ sf: "doc.text", lucide: FileText }}
					title={file.title || file.name}
					subtitle={[
						file.name,
						sizeLabel(file.size),
						"Opens on the desktop",
					].join(" · ")}
				/>
			))}
		</NativeSection>
	);
}

/** Opens the transcript of a run. */
export function openTranscript(runId: string): void {
	router.push({ pathname: "/transcript/[runId]", params: { runId } });
}

/**
 * The run's own steps, one row each: its kind, its name, its state with
 * the step's color, and "4 min · $0.12". Then the row that opens the
 * transcript.
 */
export function StepsSection({
	runId,
	steps,
	labels,
	status,
	now,
	loading,
}: {
	runId: string;
	steps: readonly StepSummary[];
	labels: ReadonlyMap<string, string>;
	status: RunStatus;
	now: number;
	/** The steps load still. */
	loading: boolean;
}) {
	const { colors } = useThemeColors();
	return (
		<NativeSection title="Steps">
			{loading ? (
				<NativeTextRow text="The steps load." secondary />
			) : steps.length === 0 ? (
				<NativeTextRow text="The first step starts soon." secondary />
			) : null}
			{loading
				? null
				: steps.map((step) => {
						const item = trailItemOf(step, { labels, runStatus: status, now });
						return (
							<NativeRow
								key={item.id}
								{...nativeLook(item.look, colors)}
								overline={item.kind.label}
								title={item.label}
								subtitle={[item.look.label, item.meta, item.detail]
									.filter((part) => part !== undefined && part !== "")
									.join(" · ")}
								accessibilityLabel={trailItemLabel(item)}
							/>
						);
					})}
			<NativeRow
				icon={{ sf: "text.bubble", lucide: SquareTerminal }}
				title="Transcript"
				subtitle="What the agent did, step by step"
				onPress={() => openTranscript(runId)}
			/>
		</NativeSection>
	);
}

/**
 * The command that opens the agent's session of this run in a terminal,
 * in mono. Touch and hold it to copy it, or share it. A share tells Night
 * Shift you took the run over: Needed you counts it.
 */
export function TakeOverSection({
	command,
	computer,
	onShare,
}: {
	command: string;
	computer: string;
	onShare: () => void;
}) {
	return (
		<NativeSection
			title="Take over"
			footer={`Go on with the agent in a terminal on ${computer}.`}
		>
			<NativeCustomRow>
				<View className="py-1">
					<Text
						selectable
						accessibilityHint="Touch and hold to copy the command."
						className="font-mono text-sm"
					>
						{command}
					</Text>
				</View>
			</NativeCustomRow>
			<NativeButtonRow
				label="Share the command"
				icon={{ sf: "square.and.arrow.up", lucide: ShareIcon }}
				onPress={onShare}
			/>
		</NativeSection>
	);
}
