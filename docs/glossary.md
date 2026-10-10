# Night Shift Glossary

The ubiquitous language of Night Shift. Issue bodies, steering docs, and code use these terms. One name for one thing.

The Method context speaks the method's own language. For WTF that is Epic, Feature, Trace, Spine, and Scenario Claim. The Run context speaks only in Flow, Step, and Gate. The translation happens in the method package, never in the engine.

## STE allowlist

| Term | Kind | Meaning | Source |
|------|------|---------|--------|
| Developer | actor | Owns a clone of the repo and a coding-agent CLI. Starts runs and resolves technical gates. | VISION |
| Product Owner | actor | Writes and approves Epics and Features. Does not read code. | VISION |
| QA Engineer | actor | Verifies scenarios and files bugs. | VISION |
| Runner Operator | actor | Keeps a machine that runs sessions for the team. | VISION |
| Method Author | actor | Maintains a method package: its skills, artifact types, and flows. | VISION |
| Member | actor | A person in a Workspace with read or write access to its Projects. Local mode has one Member with write access. | Feature #7 |
| Method | context | What a spec-driven method is: artifact types, lifecycle states, flows, skills, detection. | VISION |
| Run | context | Executing a flow against a project: frontier, scheduling, run policy, gates, decisions. | VISION |
| Session | context | One harness session on one runner: transcript, tool calls, needs-input, resume. | VISION |
| Connector | context | Reading and writing artifacts and code-host objects on behalf of a project. | VISION |
| Workspace | context | Who may do what, where: tenancy, projects, repos, bindings, configuration. | VISION |
| Method Package | object | A skill pack plus a `method.json` manifest that declares artifact types, lifecycle states, detection markers, profiles, and flows. | Epic #1 |
| Skill Pack | object | The skill directories of a Method Package, pinned to one version. | Epic #1 |
| Artifact Type | object | One kind of spec the method knows, for example Epic, Feature, Trace, or Change. | Epic #1 |
| Detection Marker | object | A file or directory whose presence binds a repo to a method, for example `.wtf/config.json`. | Epic #1 |
| Flow | object | A named graph of Steps declared by a Method Package. | Epic #1 |
| Step | object | One node of a Flow. It names a skill, an Agent Profile, its inputs, its needs-input mode, and whether a Gate follows. | Epic #1 |
| Agent Profile | object | A named harness, model, effort, permission mode, time budget, and sandbox provider. Flows reference profiles by name. | Epic #1 |
| Project | object | One bound repository with one method and one artifact connector inside a Workspace. | Epic #1 |
| Repo Binding | object | The link between a Project and a local clone on one machine. | Epic #1 |
| Project Config | object | The versioned file `.nightshift/project.json` with a published schema. | Epic #1 |
| Doctor | object | The check that validates a Project Config and a Method Package and reports Findings. | Epic #1 |
| Finding | object | One Doctor result: a severity, a message, and a fix. | Epic #1 |
| Runner | object | The daemon on one machine that starts Sessions. | Epic #1 |
| Session | object | One harness session for one Step Run, with a Transcript and a Step Report. | Epic #1 |
| Transcript | object | The structured event stream of a Session, stored in full on disk and indexed in the database. | Epic #1 |
| Step Report | object | The structured result a Session returns at its end: outcome, artifacts touched, needs-input items. | Epic #1 |
| Needs Input | object | A question a Session cannot answer alone. It becomes a Gate. | Epic #1 |
| Gate | object | A question that waits for a person in the Needs-you inbox. It holds the question, the context, and the choices. | Epic #1 |
| Needs-you inbox | object | The list of open Gates for a Project. | Epic #1 |
| Project Chat | object | The conversation view of a Project. It starts Flows and shows Steps, Gates, and outcomes. | Epic #1 |
| Artifact | object | One spec object held by an Artifact Connector, for example a GitHub issue or a repo file. | Epic #1 |
| Artifact Connector | object | The adapter that reads and writes Artifacts in one system of record. | Epic #1 |
| Code-Host Connector | object | The adapter that reads and writes Pull Requests and Stacks. | Epic #2 |
| Index | object | The cached copy of Artifacts and Pull Requests a Project holds, with the time of its last refresh. | Epic #1 |
| Spec Tree | object | The view of a Project's Artifacts in the method's own hierarchy. | Epic #1 |
| Event | object | One appended record of a fact that changed. | Epic #1 |
| Event Log | object | The append-only list of Events for a Workspace. | Epic #1 |
| Run | object | One execution of a Flow against a Project. | Epic #2 |
| Step Run | object | One execution of a Step inside a Run. | Epic #2 |
| Frontier | object | The set of Step Runs whose inputs are ready. | Epic #2 |
| Lock | object | A claim on a repo, a branch, or a declared file set that a Step Run holds while it runs. | Epic #2 |
| Run Policy | object | The rules for retries, rescue, blocked propagation, network grace, usage-limit waits, and the stop time. | Epic #2 |
| Decision | object | The schema-validated value an orchestrator checkpoint returns: continue or halt, plus steering notes. | Epic #2 |
| Checkpoint | object | A short orchestrator Step that runs after a Step Run ends and returns a Decision. | Epic #2 |
| Worktree | object | A git worktree in a sibling directory of the user's clone, used by one Session. | Epic #2 |
| Pull Request | object | A code-host pull request opened for one Trace branch. | Epic #2 |
| Stack | object | A native code-host group of Pull Requests, one per Trace of one Feature. | Epic #2 |
| Board | object | The pipeline view of a Run. Columns derive from Pull Request, check, and review facts. | Epic #2 |
| Change | object | An OpenSpec change: a proposal with specs, design, and tasks under `openspec/changes/`. | Epic #3 |
| Spec | object | An OpenSpec specification file under `openspec/specs/<name>/spec.md`. | Feature #15 |
| Archived Change | object | An OpenSpec Change moved to `openspec/changes/archive/<date>-<name>/`. | Feature #15 |
| Package List | object | The Method Packages a Project can bind: the built-in packages and packages from a git URL. | Feature #14 |
| Decision Entry | object | One line in `openspec/changes/<name>/decisions.md`: the choice, the time, the person, and a note. | Feature #16 |
| Poll Interval | object | The machine-local time between two Index refreshes. | Feature #8 |
| validate | verb | Check a Method Package or a Project Config against its schema and report Findings. | Feature #14 |
| pin | verb | Fix a Method Package to one git ref. | Feature #14 |
| propose | verb | Write an OpenSpec Change to the repo. | Feature #16 |
| apply | verb | Implement an OpenSpec Change. | Feature #16 |
| archive | verb | Move an applied OpenSpec Change to the archive. | Feature #16 |
| RunEnded | event | A Run ended because no Step Run remained. | Feature #9 |
| bind | verb | Attach a local clone to a Project and detect its method. | Epic #1 |
| detect | verb | Find the method of a repo from its Detection Markers. | Epic #1 |
| materialize | verb | Copy a pinned Skill Pack into a per-run plugin directory. | Epic #1 |
| start | verb | Begin a Session or a Run. | Epic #1 |
| resolve | verb | Answer a Gate with one of its choices. | Epic #1 |
| write back | verb | Record a Gate resolution or a Step outcome on the Artifact. | Epic #1 |
| index | verb | Refresh the cached copy of Artifacts or Pull Requests. | Epic #1 |
| report | verb | End a Session with a Step Report. | Epic #1 |
| retry | verb | Start a fresh Session for a failed Step Run with a tight brief. | Epic #2 |
| rescue | verb | Retry a Step Run with a stronger Agent Profile. | Epic #2 |
| propagate | verb | Mark the dependents of a blocked Step Run as blocked. | Epic #2 |
| resume | verb | Continue a Session with its own session id. | Epic #2 |
| take over | verb | Hand a Session to a person with its resume command. | Epic #2 |
| halt | verb | Stop a Run at a Checkpoint and open a Gate. | Epic #2 |
| reclaim | verb | Delete a clean Worktree that no Session uses. | Epic #2 |
| stack | verb | Link Pull Requests into one Stack. | Epic #2 |
| ProjectBound | event | A clone was bound to a Project. | Epic #1 |
| MethodDetected | event | A Project's method was found from its markers. | Epic #1 |
| FindingRaised | event | The Doctor found a problem. | Epic #1 |
| SkillPackMaterialized | event | A Skill Pack was copied for one Run. | Epic #1 |
| SessionStarted | event | A Session began on a Runner. | Epic #1 |
| SessionEnded | event | A Session ended with a Step Report. | Epic #1 |
| GateOpened | event | A Gate was placed in the Needs-you inbox. | Epic #1 |
| GateResolved | event | A person answered a Gate. | Epic #1 |
| ResolutionWrittenBack | event | A Gate resolution was recorded on the Artifact. | Feature #7 |
| WriteBackFailed | event | A write back to the Artifact failed and can be started again. | Feature #7 |
| ArtifactCreated | event | An Artifact Connector created an Artifact. | Epic #1 |
| ArtifactIndexed | event | The Index of a Project was refreshed. | Epic #1 |
| FlowRequested | event | A Project Chat message asked for a Flow. | Epic #1 |
| RunStarted | event | A Run began. | Epic #2 |
| StepRunStarted | event | A Step Run left the Frontier and got a Session. | Epic #2 |
| StepRunEnded | event | A Step Run ended with an outcome. | Epic #2 |
| StepRetried | event | A failed Step Run got a fresh Session. | Epic #2 |
| StepRescued | event | A failed Step Run got a stronger Agent Profile. | Epic #2 |
| StepBlocked | event | A Step Run was marked blocked. | Epic #2 |
| UsageLimitHit | event | A Session paused on a harness usage limit. | Epic #2 |
| DecisionRecorded | event | A Checkpoint returned a Decision. | Epic #2 |
| RunHalted | event | A Checkpoint halted the Run. | Epic #2 |
| RunStopped | event | A Run reached its stop time or a person stopped it. | Epic #2 |
| LockAcquired | event | A Step Run took a Lock. | Epic #2 |
| LockReleased | event | A Step Run released a Lock. | Epic #2 |
| WorktreeCreated | event | A Worktree was created for a Session. | Epic #2 |
| WorktreeReclaimed | event | A clean Worktree was deleted. | Epic #2 |
| PullRequestOpened | event | A Pull Request was opened for a Trace. | Epic #2 |
| StackLinked | event | Pull Requests were linked into a Stack. | Epic #2 |
| SessionTakenOver | event | A person took over a Session. | Epic #2 |
| MethodPackageValidated | event | A Method Package passed the Doctor. | Epic #3 |
| FlowOverridden | event | A repo file replaced a Flow of the Method Package. | Epic #3 |
| ChangeProposed | event | An OpenSpec Change was written to the repo. | Epic #3 |
| ChangeApplied | event | An OpenSpec Change was implemented. | Epic #3 |
| ChangeArchived | event | An OpenSpec Change was archived. | Epic #3 |
