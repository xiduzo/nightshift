import {
	agentSource,
	type HowOften,
	linksIn,
	localZone,
	messageOf,
	type NoteToCheck,
	readSource,
	type ToldSource,
	toldNote,
} from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldContent,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Switch } from "@nightshift/ui/components/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpenIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { toastFailure } from "@/shared/failure";
import { KnowledgeSection, useKnowledge } from "../layout";
import { knowledgeMutations, knowledgeQueries } from "../queries";
import { MeaningLine, useKnowledgeHits } from "../search";
import { AskAnswer } from "./ask-answer";
import { AskTellBox, type BoxMode } from "./ask-tell-box";
import {
	LearningsFooter,
	LearningsToCheck,
	useNotesToCheck,
} from "./learnings-to-check";
import { factsLine, type TellOutcome, tellReply } from "./overview-words";
import { OftenSelect, ToldLinkRows, useToldLinks } from "./told-links";

/** How often an agent fetches what a person describes, unless they choose. */
const AGENT_OFTEN: HowOften = "week";

/**
 * A project's Knowledge as Ask and tell: what agents would find, a box to
 * tell them more, and the learnings to check one note at a time. The child
 * pages hold the details: All knowledge opens Files, the breadcrumb the
 * others.
 */
export function KnowledgeOverviewPage() {
	const { projectId, knowledge, openFile } = useKnowledge();
	const navigate = useNavigate();
	const { can } = knowledge;
	const tells = can.startRuns;
	const [mode, setMode] = useState<BoxMode>("ask");
	const search = useKnowledgeHits(projectId, { enabled: mode === "ask" });
	const [changing, setChanging] = useState<NoteToCheck | null>(null);
	const [byAgent, setByAgent] = useState(false);
	const [agentOften, setAgentOften] = useState<HowOften>(AGENT_OFTEN);
	const [sending, setSending] = useState(false);
	const agentId = useId();
	const notes = useNotesToCheck(projectId);
	const told = useToldLinks(projectId, search.text, {
		enabled: mode === "tell" && changing === null && can.save,
		schedules: can.schedules,
	});
	const questions = useQuery({
		...knowledgeQueries.questions(projectId),
		meta: { quietErrors: true },
	});
	const asked = questions.data?.asked ?? [];

	const save = useMutation(knowledgeMutations.saveSource());
	const sync = useMutation(knowledgeMutations.syncSource());

	/** Saves one source, and starts it when the person may. Returns what did not work, or null. */
	const addSource = async (one: ToldSource): Promise<string | null> => {
		let name: string;
		try {
			const saved = await save.mutateAsync({
				projectId,
				...one,
				...(one.keepUpToDate ? { timeZone: localZone() } : {}),
			});
			name = saved.name;
		} catch (error) {
			return `This did not save: ${messageOf(error)}`;
		}
		if (!can.startRuns) return null;
		try {
			await sync.mutateAsync({ projectId, name });
			return null;
		} catch (error) {
			return `Saved, but the first read did not start: ${messageOf(error)}`;
		}
	};

	const clearBox = () => {
		search.clear();
		told.reset();
		setByAgent(false);
		setAgentOften(AGENT_OFTEN);
		setChanging(null);
	};

	const send = async () => {
		const text = search.text.trim();
		if (mode !== "tell" || text === "" || sending) return;
		setSending(true);
		try {
			if (changing) {
				const kept = await notes.tell({ note: text, replaces: changing });
				if (kept) {
					toast.success("Changed. Agents read your note from their next run.");
					clearBox();
				}
				return;
			}
			const outcome: TellOutcome = {
				note: false,
				read: [],
				agent: 0,
				started: can.startRuns,
				gone: 0,
				unread: 0,
				failed: [],
			};
			const links = told.links;
			if (links.length === 0 && byAgent) {
				const problem = await addSource(agentSource({ text }, agentOften));
				if (problem) outcome.failed.push(problem);
				else outcome.agent++;
			} else {
				for (const link of links) {
					const { look, plan } = link;
					if (!look || !plan || plan.action === "none") {
						outcome.gone++;
						continue;
					}
					if (plan.action === "agent" && !link.agent) {
						outcome.unread++;
						continue;
					}
					const problem = await addSource(
						plan.action === "read"
							? readSource(look, {
									much: link.much ?? "page",
									often: link.often,
								})
							: agentSource(
									{ link: link.url, transcript: plan.transcript },
									link.often,
								),
					);
					if (problem) outcome.failed.push(problem);
					else if (plan.action === "read") outcome.read.push(link.often);
					else outcome.agent++;
				}
				// Links Night Shift looked at become sources: the words around them are the note.
				const note =
					linksIn(text).length > 0 && can.save ? toldNote(text) : text;
				if (note !== null) outcome.note = await notes.tell({ note });
			}
			// Night Shift answers in a toast: what it saved, what it reads, what stays out.
			const reply = tellReply(outcome);
			if (outcome.failed.length > 0 || outcome.gone > 0 || outcome.unread > 0) {
				toast.warning(reply);
			} else {
				toast.success(reply);
			}
			clearBox();
		} finally {
			setSending(false);
		}
	};

	const findIt = useMutation({
		mutationFn: async (question: string) => {
			const saved = await save.mutateAsync({
				projectId,
				...agentSource({ question }, "once"),
			});
			return sync.mutateAsync({ projectId, name: saved.name });
		},
		onSuccess: (run) =>
			toast.success("An agent looks for it now", {
				action: {
					label: "View run",
					onClick: () =>
						void navigate({ to: "/runs/$runId", params: { runId: run.id } }),
				},
			}),
		onError: toastFailure("The agent did not start"),
	});

	const asking = mode === "ask" && search.query !== "";
	const linkCount = linksIn(search.text).length;
	const blockedBy =
		mode === "tell" && changing === null && told.looking
			? "Night Shift still looks at the links."
			: null;

	return (
		<div className="flex flex-1 flex-col gap-6">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
				<KnowledgeSection
					title="What should your agents know?"
					description={factsLine({
						files: knowledge.files.length,
						sources: knowledge.syncs.length,
						asked: asked.length,
						answered: asked.filter((question) => question.hits.length > 0)
							.length,
					})}
					actions={
						<Button
							variant="outline"
							nativeButton={false}
							render={
								<Link
									to="/projects/$projectId/knowledge/files"
									params={{ projectId }}
								/>
							}
						>
							<BookOpenIcon data-icon="inline-start" />
							All knowledge
						</Button>
					}
				>
					<div className="flex flex-col gap-2">
						{changing ? (
							<p className="text-sm text-muted-foreground">
								Write the note as it should be. It takes the place of the old
								one.{" "}
								<Button
									variant="link"
									size="sm"
									className="h-auto p-0"
									onClick={clearBox}
								>
									Cancel
								</Button>
							</p>
						) : null}
						<AskTellBox
							mode={mode}
							onMode={(next) => {
								setMode(next);
								if (next === "ask") setChanging(null);
							}}
							text={search.text}
							onText={search.setText}
							onSend={() => void send()}
							tells={tells}
							sending={sending}
							blockedBy={blockedBy}
							inside={
								mode !== "tell" || changing ? null : linkCount > 0 &&
									can.save ? (
									<ToldLinkRows told={told} schedules={can.schedules} />
								) : search.text.trim() !== "" && can.save ? (
									<Field
										orientation="horizontal"
										className="border-t px-3 py-2"
									>
										<Switch
											id={agentId}
											checked={byAgent}
											onCheckedChange={setByAgent}
										/>
										<FieldContent>
											<FieldLabel htmlFor={agentId} className="font-normal">
												Let an agent fetch this from where it lives
											</FieldLabel>
										</FieldContent>
										{byAgent ? (
											<OftenSelect
												value={can.schedules ? agentOften : "once"}
												schedules={can.schedules}
												onChange={setAgentOften}
											/>
										) : null}
									</Field>
								) : null
							}
						/>
						{mode === "ask" ? <MeaningLine projectId={projectId} /> : null}
					</div>
					{asking ? (
						<AskAnswer
							query={search.query}
							hits={search.hits.data}
							error={search.hits.error}
							onOpen={openFile}
							onTell={
								tells
									? () => {
											setMode("tell");
											search.setText("");
										}
									: undefined
							}
							onFind={
								can.save && can.startRuns
									? () => findIt.mutate(search.query)
									: undefined
							}
							finding={findIt.isPending}
						/>
					) : (
						<LearningsToCheck notes={notes} />
					)}
				</KnowledgeSection>
			</div>
			{asking || changing ? null : (
				<LearningsFooter
					notes={notes}
					onAnswer={notes.settle}
					onChange={(note) => {
						setChanging(note);
						setMode("tell");
						search.setText(note.note);
						window.scrollTo({ top: 0, behavior: "smooth" });
					}}
				/>
			)}
		</div>
	);
}
