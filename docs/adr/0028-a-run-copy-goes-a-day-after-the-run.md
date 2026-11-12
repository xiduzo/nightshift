# 28. A run's copy goes a day after the run, and its unsaved work stays out of sight

Status: accepted, 2026-11-12. Built, 2026-11-12.

## Context

Each run works in its own worktree, `<repo>.nightshift/<short>`, on the branch
`nightshift/<short>`. The cleanup removed a worktree and its local branches
only when nothing was lost, and only `cleanUpAfterDays` (90 days) after the run
ended. A person removed the rest by hand on the project's Branches page.

So clones filled up with hundreds of worktrees and branches. Nobody opened the
Branches page. On 2026-11-12 the owner asked to remove the page, and to have
Night Shift clean up worktrees and branches on its own, every day.

Two facts made the old rule keep too much:

- A pull request that GitHub merges by a squash or a rebase gives the default
  branch new commits. `git rev-list` then counts the run's commits as "only
  here". A real run (`nightshift/0c34f1b1`, two commits) kept its branch for
  this reason, although its pull request was merged.
- An agent can check out a branch of its own in the run's worktree (a real run
  was on `tune/1110`). The worktree is the run's, the branch is not.

The owner chose two policies: hide, then expire, and rebuild the copy.

## Decision

1. **A run's copy and branches go a day after the run ended.** The sweep runs
   every 6 hours, the first a minute after the engine is ready
   (`cleanup/job.ts`). It removes the worktree and deletes the local branches
   of each run that ended one day ago or more (`RUN_COPY_DAYS`). It never
   touches a run that runs, waits at a Gate or sleeps. It never touches a
   branch on origin, and it never pushes.
2. **Work that is only here goes out of sight first.** Before the removal, the
   sweep writes kept refs under `refs/nightshift/kept/<short>/`
   (`keptRefsOf`). `git branch` does not list them.
   - `copy` holds the state of the worktree when it has work that is only
     here. Changes that are not committed become one commit on top of HEAD.
     Night Shift makes that commit through an index of its own, so no branch
     moves.
   - `heads/<branch>` holds each run branch, or Item Branch, with commits that
     are only here.
3. **The kept refs go `cleanUpAfterDays` after the run ended.** The setting
   keeps its default of 90 days. It now counts for kept work and for run
   folders. A kept ref of a run that this computer does not know stays,
   because nothing tells when that run ended.
4. **Merged work counts as saved, also after a squash or a rebase.** Git alone
   tells it, with no `gh` and no service. `git cherry` finds commits whose
   change the default branch has (a rebase merge). For a squash merge, a
   throwaway commit with the branch's tree on the merge base goes to
   `git cherry`. The default branch counts on origin and locally.
5. **A branch that the run made itself stays.** Only `nightshift/<short>` and
   `nightshift/<short>-…` are run branches. The worktree goes when its state
   is saved, or after the sweep kept it in `copy`. A run branch that another
   worktree has checked out stays, because a person works on it. A worktree
   that git does not know stays, as before.
6. **Resume and Run again make the copy again.** A step that works in the
   copy asks the Device that has the work (`Device.restoreWorktree`), with
   the folder that the run's log names there. When that folder is gone, the
   Device makes the worktree again at its place, on the run's branch, from
   the first of these:
   1. The run's branch on this computer. When the kept `copy` descends from
      it, the kept `copy`, because it has the uncommitted changes too.
   2. The kept `copy`, else the kept run branch.
   3. The run's branch on origin, after a fetch. A Hand-off pushes it too.
   4. The commit the run started from.

   Each kept run branch becomes a local branch again. A kept ref that a local
   branch has again goes. The run warns where the copy came from
   (`RunWarned`, `base-ref`). Each drive asks each Device once. The work relay
   has the call `restoreWorktree`. A Device of an older version cannot read
   it, and the step works as before.
7. **The Branches page goes.** Its API procedures (`projects.runCopies`,
   `removeRunCopy`, `deleteRunBranches`) and its engine methods go with it.
   `WorktreeRemoved` stays the record of each removal. It names the kept refs
   it wrote (`kept`) and the kept refs it deleted (`expired`).

## Consequences

- A clone keeps only the runs of the last day in sight. `git branch` shows no
  old run branches.
- Unsaved work survives for `cleanUpAfterDays`. A person gets it back with
  Resume or Run again, or with
  `git branch <name> refs/nightshift/kept/<short>/copy`.
- A copy made again from the commit the run started from does not have the
  changes of earlier steps. The run warns about it. This happens only when the
  work was merged and its branch is gone from origin, or when there was no
  work.
- The daemon still does not resume an interrupted run on its own when its
  copy is gone. A person's Resume makes the copy again.
- Kept refs of a run that this computer does not know stay until a person
  deletes them.
