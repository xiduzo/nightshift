# 4. Knowledge belongs to the Space

Status: accepted, 2026-10-30

## Context

Sprint 2 gave each Project a knowledge folder: `<dataDir>/knowledge/<projectId>/`
on each Device. Sync kits fill it, agents read it, and agents propose
learnings into it. Each Device has its own folder, and nothing syncs it.
This causes problems:

- A run on the Host, or on a second computer, does not see what the sync
  kits wrote on the first computer.
- A learning that an agent proposes stays on the Device that ran the step.
  The review Gate can run on another Device and find nothing.
- The Knowledge page shows the folder of the computer that serves the page.
  A Member who opens the Host sees the Host's folder, which is often empty.
- Search (sprint 3) would give a different answer on each Device.

Flows had the same problem, and [ADR 2](0002-flows-are-night-shift-data.md)
moved them into the Space. Knowledge follows, with one difference: it can
be large. A Confluence space or a wiki can be thousands of pages, and the
kits replace their folder on each sync. A Yjs document loads whole into
memory and keeps a trace of what it deletes
([devices](../research/devices.md), "Sync layers"). So the content cannot
be in the document.

## Decision

1. **Knowledge belongs to the Project in its Space.** Every Device of the
   Space works on the same knowledge. A Space without a Host keeps it on
   its one Device.
2. **One document lists the files.** `knowledge:<projectId>` is a Yjs
   document, synced like the flow documents. It holds one entry per file:
   its path, the hash of its content, its size, when it changed, and the
   Device that changed it. Entries merge per path. When two Devices change
   one path, the later change wins.
3. **The content is in the archive, by hash.** A Device keeps each file's
   content in its blob store, named by its hash. It copies new content to
   the Space's Host, like a step's transcript. A Device fetches the content
   it lacks from the Host. Content never changes after it is written, so
   nothing merges.
4. **The folder is a working copy.** Agents and kits still read and write
   plain files in `<dataDir>/knowledge/<projectId>/`. Before and after each
   step that gets the folder, the Device that runs the step reconciles the
   folder with the document:
   - A file the step changed goes into the blob store and the document.
   - An entry that another Device changed is fetched and written to the
     folder.
   - When both changed the same path, the later change wins.

   `--add-dir`, `NS_KNOWLEDGE`, `INDEX.md` and the kits stay as they are.
5. **Learnings are files like any other.** A proposal is
   `learnings/proposed/<runId>.md` and a kept learning is in
   `learnings/accepted/`. One run writes one proposal file, so proposals
   from two Devices never touch the same path. `kit:knowledge/review-learnings`
   works unchanged on whichever Device runs it.
6. **Sources are the sync flows.** What fills the folder (which kit, which
   settings, when) is already a flow and a schedule in the flow document.
   The knowledge document does not repeat it.
7. **The search index is each Device's own.** A Device builds its index
   from its working copy. The index never syncs: it is derived data.
8. **Who may read and write.** A Member of the Space reads the document
   and the content. A Device of a Member whose role may start runs changes
   the document, because that Device runs the steps that change the
   folder. A browser changes knowledge only through the procedures.
9. **Large files stay home.** A file larger than 10 MB stays on the Device
   that has it. Its entry says so, and other Devices list it but do not
   fetch it.
10. **One import on upgrade.** On the first start after the upgrade, each
    Device publishes the files of its folders. When two Devices have the
    same path, the later change wins, as in decision 2.

## Consequences

- A Project's knowledge goes to the Space's Host. In a shared Space, every
  Member can read it. Before you sync a client's Jira or Confluence into a
  shared Space, make sure that each Member may see it. The Knowledge page
  says this where you add a source.
- The Knowledge page works on every Device and on the Host. It lists the
  document, and it fetches a file's content when a person opens it.
- A Device that cannot reach the Host works on its own copy. Its changes
  merge when the Link is back.
- The Host's disk holds every Project's knowledge. Retention is undecided,
  as it is for run history. Content that no entry names any more can be
  removed later.
- A run reads the knowledge as it was when its step started. A run does
  not record which version of the knowledge it read.
