# Mobile: the night watch, native pages and speed

Status: decided 2026-10-31, not built. This note sets what the phone app
is for, now that the desktop app has grown. It also gives the plan for
native pages and for a faster app. The design of the phone app itself
stays in [mobile.md](mobile.md).

## Why

Since 2026-10-23 most work went into the desktop app: the project
Console, Knowledge, run cost, Ask why, Changed files, Devices, Agents and
Settings. The phone app got almost none of it. The phone also builds its
own page headers and renders every list in full. It feels slower than it
must.

## Position: the night watch

The desktop is where you build Night Shift and set it up. The phone is
where you keep watch. It answers three questions in under 10 seconds:

1. Does something need me? Gates, failures and learnings that wait.
2. How did it go? Last night, cost and what changed.
3. Can I nudge it? Answer, start, stop, retry, pause and ask why.

The rule: **act and read on the phone, build and set up on the desktop.**
A feature that needs a keyboard or a canvas stays on the desktop.

### What comes to the phone

| On the phone | Glance only | Desktop only |
| --- | --- | --- |
| Ask why a run did not finish. One answer, no thread. | Run cost, tokens and length, per run and per step | The flow editor, Sections, the assistant chat and Suggest |
| Approve or reject the learnings that wait | The project Console, kept simple | Flow revisions, kept variables and webhooks |
| Retry or resume a run that stopped | Changed files of a run: a list with line counts, no diff | Agents, profiles, tool logins and Secrets |
| A Gate's deadline, counting down | Flow health: a computer the flow needs is offline | Knowledge sources and their sync |
| The time of the morning digest | Devices: which computers and the Host are online | Run budget, turn limit, idle timeout and Monitoring |
| Schedules: **Pause tonight** and **Run now** | Schedules: what runs tonight, and when | Pairing, Offers and Space members (except accepting an invite) |

Pause tonight and Run now are nudges, not edits. Editing a schedule
stays out of scope, as [mobile.md](mobile.md) says.

The tabs stay Home, Inbox, Runs and Projects. The Inbox does not take the
learnings for now. We look at the tabs again when the new features are in.

## What is true today

| Fact | Where |
| --- | --- |
| One query client for both apps. It tries again only when the Host does not answer. Data is fresh for 60 s. | `packages/client/src/api/query-client.ts` |
| The phone feeds app focus and the network to TanStack Query. | `apps/mobile/src/shared/api/query-client.ts` |
| The phone keeps the list queries on disk, one JSON file per Host and Person, for 24 h. A new build or update drops it. | `apps/mobile/src/shared/api/kept-cache.ts`, `kept-queries.ts` |
| The live cache follows the Host's notifications stream. It reads again only what an item changed. Lists do not poll. | `packages/client/src/live/cache.ts` |
| Every screen reads all its queries again each time it gets the focus. | `apps/mobile/src/shared/refresh/use-screen-refresh.ts` |
| The four native tabs stay mounted. A hidden tab renders again on each live-cache change. | `apps/mobile/src/shared/shell/tab-bar.tsx` |
| `useNow()` renders a whole screen again every 30 s, in 5 places. | `apps/mobile/src/shared/format/` |
| A run screen starts from a skeleton, also when the list cache has the run. | `apps/mobile/src/features/runs/run-screen.tsx` |
| The transcript keeps its entries in component state. Each open streams the run from the start. | `packages/client/src/live/use-live-run.ts` |
| No list is virtualized. Each list is `.map()` in a `ScrollView`, in a Card (`ListGroup`). | `apps/mobile/src/shared/page/screen.tsx`, `shared/list/list-group.tsx` |
| Tabs hide the native header and draw their own (`LargeTitleHeader`). Sheets hide the header too. | `apps/mobile/src/shared/header/`, `src/app/_layout.tsx` |
| The kept queries have the default `gcTime` of 5 min, less than the 24 h `maxAge`. A query that no screen uses goes before it reaches the disk. | `kept-cache.ts` |

Checked in the installed packages on 2026-10-31:

- `@tanstack/react-query` 5.104.1 has the `subscribed` option and
  `streamedQuery`.
- `@orpc/tanstack-query` has `streamedOptions` and `liveOptions`, also
  under `experimental_` names.
- `expo-router` 58.0.24 has `Stack.Toolbar`, `Stack.SearchBar` and
  `expo-router/native-tabs`.
- Neither FlashList nor LegendList is installed.

## Strategy

The stream is the source of truth. The cache answers at once. A screen
renders only when what it shows changes.

### A. Read less

- `useScreenRefresh` no longer reads again on focus. Pull to refresh
  stays.
- Screen queries get `subscribed: useIsFocused()`. A hidden tab does not
  render. When it comes back, a query that the live cache marked stale
  reads again by itself.
- `staleTime` follows the kind of data:

  | Data | `staleTime` | Why |
  | --- | --- | --- |
  | Gates and runs | `Infinity` | The live cache marks them stale. After a drop of the stream it reads them all again. |
  | Dashboard and Console | 5 min | Totals change slowly. |
  | Projects, flows, Spaces and schedules | 10 min | They change on the desktop, seldom. |

### B. Show at once

- A detail screen starts from the list. `runs.get` gets
  `placeholderData` from the run in a `runs.list` cache. A Gate screen
  starts from `gates.list`. The title, status and project show at once.
  The steps follow.
- A row prefetches its detail on `onPressIn`.
- A push prefetches what it opens (`runs.get`, `gates.list`) before the
  person taps it. The lock-screen code does this for a run already.
- Run actions (stop, resume, retry) and the schedule actions (Pause
  tonight, Run now) show their result at once. They use
  `useMutation().variables`, not `onMutate` with a rollback.

### C. Keep what helps

- The transcript keeps its entries in the query client, per run, for a
  few minutes. A new open follows on from the last entry (`lastSeq`).
- We keep our own `followRun` for the stream (reconnect and batches). We
  do not move to `streamedQuery` or oRPC `streamedOptions`. Both are
  experimental.
- The kept queries get a `gcTime` of at least `maxAge` (24 h).
- The kept cache holds only the first page of Runs.
- We measure the cost of a cache write first. If it shows, the storage
  moves to `react-native-mmkv`.

### D. Render less

- One list library: **FlashList v2** (new architecture only, no size
  estimates).
  - The Inbox: flat data with sticky section headers.
  - Runs and a project's runs: `onEndReached` reads the next page.
  - The transcript: `maintainVisibleContentPosition`. If it misbehaves
    there, LegendList replaces it for the transcript only.
- The card look moves into the row. The first and last rows get round
  corners. The Separator becomes `ItemSeparatorComponent`. The rows stay
  React Native Reusables components.
- Rows are `memo`. `select` functions sit at module level. Callbacks are
  stable. A recycled row holds no state of its own.
- The clock moves into a small `<Ago>` text on one shared ticker
  (`useSyncExternalStore`). Only that text renders every 30 s.

### E. Native pages

- Each tab gets its own Stack with `headerLargeTitle`. The scroll view is
  the first child of the screen, with
  `contentInsetAdjustmentBehavior="automatic"`, so the title collapses.
- `Stack.SearchBar` replaces the Search sheet.
- `Stack.Toolbar` holds the header actions: the Space picker and the
  avatar.
- Sheets show a native header with their title.
- `LargeTitleHeader` goes.
- The Gate's answer bar stays a `KeyboardStickyView`. It must stay above
  the keyboard.

### F. Measure first

Measure on a real phone (a release build) before each step and after it:

| Measure | What |
| --- | --- |
| Cold start | From the tap on the icon until the Inbox shows its Gates |
| Tab switch | From the tap until the tab shows its data |
| Open a run | From the tap on a row until the steps show |
| Scroll | Frames per second over 300 or more runs |
| Renders | Renders of a hidden tab while a run streams (React DevTools Profiler) |

## Slices

Each slice goes to `main` with its numbers before and after. Build in a
worktree. The dev daemon in the main checkout runs real work.

1. **Baseline.** The measures of F, on iOS and Android.
2. **Native pages.** E.
3. **Read less, show at once.** A and B.
4. **Lists.** D.
5. **Keep what helps.** C.
6. **The night watch features**, in this order:
   1. Ask why
   2. Retry and resume
   3. Schedules with Pause tonight and Run now
   4. Learnings
   5. Run cost
   6. Changed files
   7. The Gate deadline
   8. The digest time
   9. The Console glance

## Sources

- TanStack Query, React Native:
  https://tanstack.com/query/latest/docs/framework/react/react-native
- TanStack Query, persistQueryClient:
  https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient
- TanStack Query, initial data:
  https://tanstack.com/query/latest/docs/framework/react/guides/initial-query-data
- TanStack Query, render optimizations:
  https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations
- TanStack Query, optimistic updates:
  https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
- oRPC, TanStack Query: https://orpc.dev/docs/integrations/tanstack-query
- FlashList v2: https://shopify.github.io/flash-list/docs/v2-changes
- FlashList recycling: https://shopify.github.io/flash-list/docs/recycling
- LegendList: https://legendapp.com/open-source/list/
- Expo Router Stack: https://docs.expo.dev/router/advanced/stack/
- Expo Router native tabs: https://docs.expo.dev/router/advanced/native-tabs/
