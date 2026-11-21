import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/engine` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_ENGINE: Record<string, Place> = {
	// The guided setup of an agent CLI and of a decider.
	"agent-setup": "agents",
	// What a Replica keeps of a Space for the other Replicas, by hash.
	archive: M,
	// The store of the files a run keeps.
	artifacts: M,
	assistant: "assistant",
	// The removal of what ended runs left on this computer.
	cleanup: "runs",
	// The types the engine's ports name.
	contract: M,
	dashboard: "dashboard",
	// The execution port (`Device`): how a command, a tool call or a web
	// request of a step runs on this computer. Not the Devices a person
	// pairs and offers: those are `devices`.
	device: M,
	// This computer's configuration in its Device document. Its connection
	// store passes the secrets on to `secrets`.
	"device-config": "settings",
	// The synced documents (Yjs).
	documents: M,
	"file-loaders": M,
	flows: "flows",
	"folder-snapshot": M,
	// The answer to a Gate and the Needs-you inbox, in rings.
	gates: "gates",
	// The git port, the run worktrees and the branches of ended runs. It
	// runs git, and no person asks it for anything.
	git: M,
	// The `gh` program: the sign-in, the repositories and the pull
	// requests, for the project copies and the Scores.
	github: M,
	// It walks a flow (decision 9 of the hexagon series).
	graph: M,
	// Where this computer keeps values it must not show: the keychain,
	// else files. The secrets of this computer and the Device keys use it.
	"key-store": M,
	knowledge: "knowledge",
	// The keeper of the names a Lease node holds.
	leases: M,
	// The event log: the one door to a run's facts.
	log: M,
	// The store of what a Since last run node saw.
	memory: M,
	// The `ollama serve` Night Shift finds or starts, and its models.
	ollama: M,
	// The plan of where a run's steps run, made once at the start.
	placement: "runs",
	projects: "projects",
	// The read model of a run: pure projections of the log. The walk
	// (`graph`) reads them too, so they are machinery, not part of `runs`.
	read: M,
	// The run path in rings, one sub-vertical per part: who may see or
	// act on a run (`access`), what every use case that writes to a run
	// shares (`walk`), what people see of the runs (`views`), the start,
	// the actions, the move and the recovery.
	runs: "runs",
	// The store of a run's own folder.
	"run-folders": M,
	// A run's status and the actions it allows. The pure rule kernel of
	// the engine (decision 37 of the hexagon series): the machinery and
	// the capabilities both read it.
	"run-status": M,
	schedules: "schedules",
	// The keeper of the pull request Scores: it reads what GitHub says
	// became of a run's pull request, and writes it to the run log. No
	// person asks it for anything. Score is a word of the glossary, as
	// Lease is: the capabilities that show Scores read the log.
	scores: M,
	// The secrets a use reads by the Secret scope rule: this computer's, the
	// Personal ones and those of a run's Space and Project, in rings.
	secrets: "secrets",
	// The keeper of the processes a Service node starts.
	services: M,
	// Projects to another Space as one operation (`Engine.moveProjects`).
	// It holds the order of a move and what a move refuses, so it is a
	// capability. It imports `projects`, `flows` and `runs`, so it is not a
	// part of one of them: `projects` would close a cycle with `runs`.
	"space-move": "space-move",
	spaces: "spaces",
	// Moments noted for the anonymous usage export.
	usage: M,
	// The store of the kept variables.
	variables: M,
	// The rule for every address this computer connects to.
	"web-access": M,
};
