# shadcn/ui reference

The web app is built from [shadcn/ui](https://ui.shadcn.com/docs/components)
components and [blocks](https://ui.shadcn.com/blocks), and almost nothing else.
This page lists every component and block, what it is for, and where Night
Shift uses it. The rule itself is in `AGENTS.md`.

## Setup

- **Style:** `base-vega`, on [Base UI](https://base-ui.com) primitives. Base
  UI, not Radix: a component takes a `render` prop where Radix takes `asChild`.
- **Base color:** `neutral`. **Icons:** `lucide-react`. **Fonts:** Geist and
  Geist Mono (`font-geist`, `font-geist-mono`).
- **Where things go:** components install into `packages/ui/src/components`
  and are imported as `@nightshift/ui/components/<name>`. Hooks go in
  `packages/ui/src/hooks`. Theme tokens live in
  `packages/ui/src/styles/globals.css`; the app's own tokens (status and
  outcome colors) live in `apps/web/src/index.css`.
- **Adding a component:** run the CLI from `apps/web`. It reads both
  `components.json` files and writes to `packages/ui`:

  ```bash
  cd apps/web
  bunx --bun shadcn@latest add <name>        # a component or a block
  bunx --bun shadcn@latest view <name>       # read it before installing
  bunx --bun shadcn@latest search @shadcn -q <text>
  ```

  If the CLI drops a hook into `apps/web/src/hooks` while a component imports
  it from `@nightshift/ui/hooks/...`, move the hook to `packages/ui/src/hooks`.
  A block lands in `apps/web/src/components`. Move it into the vertical that
  uses it (`src/features/<vertical>/` or `src/shared/<name>/`, see
  `docs/steering/STRUCTURE.md`): `src/components/` must not exist.
- **Do not hand-edit** generated files in `packages/ui/src/components`.
  Change the look through tokens, a variant on the call site (`className`), or
  by composing components. When a component really must change, re-add it
  with `--overwrite` and reapply the change as a small, commented diff.

## Components

✓ marks components installed in `packages/ui`. Install the others with the
CLI when you need them.

### Form and input

| Component | What it is for |
| --- | --- |
| ✓ [Field](https://ui.shadcn.com/docs/components/field) | Wraps any control with a label, description and error. `FieldSet`, `FieldLegend` and `FieldGroup` group fields; `orientation="horizontal"` for a switch or checkbox row. Use it for every form field. |
| ✓ [Button](https://ui.shadcn.com/docs/components/button) | Actions. Variants: `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`. Sizes include `sm`, `xs`, `lg`, `icon`, `icon-sm`. Use `render={<Link />}` for a link that looks like a button. |
| ✓ [Button Group](https://ui.shadcn.com/docs/components/button-group) | Joins related buttons (split buttons, prev/next, a button with a dropdown). |
| ✓ [Input](https://ui.shadcn.com/docs/components/input) | One-line text. |
| ✓ [Input Group](https://ui.shadcn.com/docs/components/input-group) | An input or textarea with addons inside the border: an icon, a prefix, a button, a counter. |
| ✓ [Input OTP](https://ui.shadcn.com/docs/components/input-otp) | One-time codes, one box per digit: the two-factor code at sign-in and in its setup (`features/access/code-input.tsx`). |
| ✓ [Textarea](https://ui.shadcn.com/docs/components/textarea) | Multi-line text: prompts, notes, JSON. `CodeTextarea` (`shared/code`) lays Shiki highlighting and `{{template}}` marks behind it, for commands and prompts. A field without a set language guesses one (`guessLanguage`). Every multi-line field opens in a larger Dialog from a button in its corner: `LargerTextarea` (`shared/larger-window`), or its parts in a template field, which adds a picker for the language. |
| ✓ [Checkbox](https://ui.shadcn.com/docs/components/checkbox) | One on/off choice inside a form, or several from a list. |
| ✓ [Radio Group](https://ui.shadcn.com/docs/components/radio-group) | One choice from a few visible options. As cards (`FieldLabel` around a horizontal `Field`): a profile's harness, a Gate's choices in the inbox. |
| ✓ [Select](https://ui.shadcn.com/docs/components/select) | One choice from a list, in a styled popup. |
| ✓ [Native Select](https://ui.shadcn.com/docs/components/native-select) | One choice through the browser's own `<select>`. Good on touch screens and in dense forms. |
| ✓ [Switch](https://ui.shadcn.com/docs/components/switch) | An on/off setting that applies at once (a schedule on or off, a Call node's "Run once per item", each notification setting). |
| [Slider](https://ui.shadcn.com/docs/components/slider) | A number in a range. |
| [Calendar](https://ui.shadcn.com/docs/components/calendar) | Pick a date or range on a month grid. |
| [Date Picker](https://ui.shadcn.com/docs/components/date-picker) | A button or input that opens a Calendar in a Popover. |
| ✓ [Combobox](https://ui.shadcn.com/docs/components/combobox) | A searchable select, with single or multiple choice (chips). |
| ✓ [Label](https://ui.shadcn.com/docs/components/label) | A label tied to a control. Inside a Field, use `FieldLabel`. |

### Layout and navigation

| Component | What it is for |
| --- | --- |
| ✓ [Accordion](https://ui.shadcn.com/docs/components/accordion) | Stacked sections that open one or many at a time. |
| ✓ [Breadcrumb](https://ui.shadcn.com/docs/components/breadcrumb) | Where a page sits: Projects › rpgdotexe › night. |
| [Navigation Menu](https://ui.shadcn.com/docs/components/navigation-menu) | Top-of-site links with dropdown panels (marketing sites). |
| ✓ [Sidebar](https://ui.shadcn.com/docs/components/sidebar) | The app shell: `SidebarProvider`, `Sidebar`, `SidebarHeader`/`Content`/`Footer`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuBadge`, `SidebarInset`, `SidebarTrigger`. Collapses to icons, turns into a Sheet on mobile. |
| ✓ [Tabs](https://ui.shadcn.com/docs/components/tabs) | Switch between views of one thing (a schedule's Time and days / Cron line, a run's Steps / Flow / Variables / Artifacts, the node inspector's Work / Results / Setup). `variant="line"` for underline tabs. |
| ✓ [Separator](https://ui.shadcn.com/docs/components/separator) | A thin rule between sections or toolbar items. |
| ✓ [Scroll Area](https://ui.shadcn.com/docs/components/scroll-area) | A scroll region with styled scrollbars (transcripts, long lists in a fixed height). |
| ✓ [Resizable](https://ui.shadcn.com/docs/components/resizable) | Panels with a drag handle between them. On a run: the run's tabs above, and the step console below, a `collapsible` panel whose collapsed size is its one-line bar. |

### Overlays and dialogs

| Component | What it is for |
| --- | --- |
| ✓ [Dialog](https://ui.shadcn.com/docs/components/dialog) | A modal task: start a run, edit a schedule. |
| ✓ [Alert Dialog](https://ui.shadcn.com/docs/components/alert-dialog) | Confirm a destructive or irreversible step (stop a run, delete a flow). |
| ✓ [Sheet](https://ui.shadcn.com/docs/components/sheet) | A panel that slides in from an edge: details beside a list, a run's facts (branch, worktree, times), a flow's revisions in the editor, what an agent changed in one file, the mobile sidebar. |
| [Drawer](https://ui.shadcn.com/docs/components/drawer) | A bottom sheet for mobile (Vaul). |
| ✓ [Popover](https://ui.shadcn.com/docs/components/popover) | Small floating content on click: a picker, a short form, the flow editor's issues, the variables a template field offers after `{{`. |
| ✓ [Tooltip](https://ui.shadcn.com/docs/components/tooltip) | A short label on hover or focus, mostly for icon buttons. The hint of an inspector field, behind an info icon beside its label. Needs `TooltipProvider` (in the root). |
| ✓ [Hover Card](https://ui.shadcn.com/docs/components/hover-card) | A preview on hover (a PR, an issue, a node, the tokens a step used). |
| ✓ [Context Menu](https://ui.shadcn.com/docs/components/context-menu) | A right-click menu (canvas nodes). |
| ✓ [Dropdown Menu](https://ui.shadcn.com/docs/components/dropdown-menu) | Actions behind a button ("…" menus, user menu). |
| [Menubar](https://ui.shadcn.com/docs/components/menubar) | A desktop-app menubar (File, Edit, View). |
| ✓ [Command](https://ui.shadcn.com/docs/components/command) | A searchable list of commands; `CommandDialog` is a ⌘K palette. The list of variables a template field offers after `{{`. |

### Feedback and status

| Component | What it is for |
| --- | --- |
| ✓ [Alert](https://ui.shadcn.com/docs/components/alert) | A message in the page flow: a run failed, a run sleeps until a reset, a flow has errors. |
| ✓ [Sonner](https://ui.shadcn.com/docs/components/sonner) | Toasts (`toast()` from `sonner`). `<Toaster />` sits in the root. Toast is the older name for the same thing. |
| ✓ [Progress](https://ui.shadcn.com/docs/components/progress) | How far something is (items done of a Call with `each`, the night until stop time). |
| ✓ [Spinner](https://ui.shadcn.com/docs/components/spinner) | Something is loading or running. Put it in a Button while it is pending. |
| ✓ [Skeleton](https://ui.shadcn.com/docs/components/skeleton) | A placeholder in the shape of content that is still loading. |
| ✓ [Badge](https://ui.shadcn.com/docs/components/badge) | A short status or tag (run status, outcome, node type). Variants: `default`, `secondary`, `outline`, `destructive`, `ghost`, `link`. |
| ✓ [Empty](https://ui.shadcn.com/docs/components/empty) | A page or section with nothing in it yet, with what to do next. |

### Display and media

| Component | What it is for |
| --- | --- |
| ✓ [Avatar](https://ui.shadcn.com/docs/components/avatar) | A person or harness picture with fallback initials. |
| ✓ [Card](https://ui.shadcn.com/docs/components/card) | A bordered group of content: `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`. Stat tiles, gate cards, flow and schedule cards. The flow editor's floating panels: the flow's title card and the inspector, over a canvas that fills the page. |
| ✓ [Table](https://ui.shadcn.com/docs/components/table) | Rows and columns of data (runs, events). |
| [Data Table](https://ui.shadcn.com/docs/components/data-table) | A Table with TanStack Table: sorting, filters, pagination, row selection. A guide, not a component. |
| ✓ [Chart](https://ui.shadcn.com/docs/components/chart) | Recharts with theme colors, `ChartTooltip` and `ChartLegend`. The run-status donut (sidebar), a sparkline in every stat card on Home, the metrics chart of a project's page, and the history chart in each details dialog. Recharts keeps a 5px margin by default; set `margin` to zero on tiny charts. A chart whose values are all zero draws no bars; give it a hidden `YAxis` with a domain of at least 1. |
| [Carousel](https://ui.shadcn.com/docs/components/carousel) | Slides you swipe through (Embla). |
| [Aspect Ratio](https://ui.shadcn.com/docs/components/aspect-ratio) | Keeps media at a fixed ratio. |
| [Typography](https://ui.shadcn.com/docs/components/typography) | Class recipes for headings, paragraphs, lists, blockquotes and inline code. Copy the classes; there is nothing to install. |
| ✓ [Item](https://ui.shadcn.com/docs/components/item) | One row of a list with media, title, description and actions: `ItemGroup`, `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`. Runs in a list, gates, projects, settings rows, the links of a Gate, the phones and browsers that can notify you. |
| ✓ [Kbd](https://ui.shadcn.com/docs/components/kbd) | A keyboard key or shortcut (⌘K). |

### More

| Component | What it is for |
| --- | --- |
| ✓ [Collapsible](https://ui.shadcn.com/docs/components/collapsible) | One section that opens and closes (a tool call's input, raw JSON, a run's status under its flow, each section of the inspector). |
| ✓ [Toggle](https://ui.shadcn.com/docs/components/toggle) | A button that stays pressed (show/hide a panel, the metric tiles of a project's page). |
| ✓ [Toggle Group](https://ui.shadcn.com/docs/components/toggle-group) | A set of toggles where one or many are on: a segmented control (Canvas / JSON, transcript levels, a Command node's output Text / JSON, the range of a project's page). |
| ✓ [Pagination](https://ui.shadcn.com/docs/components/pagination) | Page links under a long list. `DataTable` shows them when it gets a `pageSize`: a project's runs page (15 a page). |
| [Direction](https://ui.shadcn.com/docs/components/direction) | Right-to-left support. |

### AI and chat (newer registry items)

These are in the registry for the `base-*` styles. Some do not have docs pages
yet; read the source with `shadcn view <name>`.

| Component | What it is for |
| --- | --- |
| ✓ `message` | One chat message: `Message`, `MessageAvatar`, `MessageHeader`, `MessageContent`, `MessageFooter`, `MessageGroup`. |
| ✓ `bubble` | A chat bubble around message text, with `BubbleGroup` and `BubbleReactions`. |
| ✓ `message-scroller` | A chat scroll area that sticks to the bottom while new content streams, with a "jump to latest" button. |
| ✓ `attachment` | A file or link attached to a message: media, title, description, actions. |
| ✓ `marker` | An inline marker in a conversation: a system note, a divider, a status line. |
| ✓ `trace` | A collapsible line of agent activity (a tool call, a thinking step) with icon, title and description. The base of the Chain of Thought, Terminal, Tool, Reasoning and Subagent patterns in a run's transcript. |
| ✓ `code-block` | Code with a header, title, copy button and Shiki highlighting (`useHighlightedCode` in `apps/web/src/shared/code`). Use for commands, logs, JSON. |
| `questionnaire` | A step-by-step set of questions with choices (a Gate's question form). |

### AI Elements patterns

[AI Elements](https://ui.shadcn.com/docs/ai-elements) patterns are recipes,
not packages: compose them from the components above. Use the Base UI pages
(`/docs/ai-elements/base/<pattern>`). Map Night Shift's own data onto them; do
not add the AI SDK.

| Pattern | What it is for |
| --- | --- |
| [Plan](https://ui.shadcn.com/docs/ai-elements/base/plan) | Steps known up front, each done, running or pending, the title counting the done ones. On `Trace`. The agent's to-do list in the step console (`features/runs/components/step-plan.tsx`, from `stepTodos` in `@nightshift/client`). |
| [Queue](https://ui.shadcn.com/docs/ai-elements/base/queue) | A to-do list split into what remains and what is done. Not used: the step console shows the agent's list as a Plan, in the agent's own order. |
| [File Tree](https://ui.shadcn.com/docs/ai-elements/base/file-tree) | Files in folders: a `Collapsible` per folder, a ghost `Button` per file. The files a step's agent changed, each opening a Sheet with its diff in `CodeBlockLine` added and removed lines (`features/runs/components/changed-files.tsx`, from `changedFiles` and `fileTree` in `@nightshift/client`). |
| [Context](https://ui.shadcn.com/docs/ai-elements/base/context) | The tokens used: an outline `Button` that opens a `HoverCard`, with a `Progress` bar of the context window when the size is known. `UsageContext` (`shared/usage`): input, cache, output and cost. No harness reports a context window yet, so it has no bar. The Tokens fact of a step. |
| [Chain of Thought](https://ui.shadcn.com/docs/ai-elements/base/chain-of-thought) | Steps folded behind one summary line that opens on them. On `Trace`, open while the last step runs. Two or more tool calls in a row in a run's transcript: "Ran 6 commands · read 3 files" (`features/runs/transcript/items/tool-calls-group.tsx`, from `groupToolCalls` and `toolCallsSummary` in `@nightshift/client`). The thoughts around and between those calls are steps inside the group. The phone shows the same line. |
| [Reasoning](https://ui.shadcn.com/docs/ai-elements/base/reasoning) | What the model thought: a `TraceLine` "Thinking…" (running, open) while it streams, then "Thought for 12s" (from the entry times), opening on the text as Markdown. One item per thought in a run's transcript (`features/runs/transcript/items/reasoning.tsx`). Only harnesses that send the thinking text have it: Claude Code sends none by default. The phone leaves thinking out. |
| [Subagent](https://ui.shadcn.com/docs/ai-elements/base/subagent) | A subagent the agent started (Claude Code's Agent or Task tool): "Ran the Explore agent", the task and how long it took, opening on the prompt, a model `Badge` when the call names one, the subagent's tool calls and thoughts as nested `Trace` lines, and its answer (`features/runs/transcript/items/subagent.tsx`, from `subagentTask` and `isLaunchNotice` in `@nightshift/client`). Not part of a Chain of Thought group. The phone shows only the call. |
| [Terminal](https://ui.shadcn.com/docs/ai-elements/base/terminal) | A command and its output: a `TraceLine` with the command as its title, a `CodeBlock size="sm"` with the output under it (Shiki `ansi`), running and error states. An agent's shell call and a Command step's command (`features/runs/transcript/items/terminal.tsx`). `TerminalOutput` is the output area: it shows parsed test results or a stack trace, with a `Toggle Group` back to the plain output. |
| [Test Results](https://ui.shadcn.com/docs/ai-elements/base/test-results) | A test run: the counts and a `Progress` bar of what passed, then a `TraceCollapsible` per file or class (open when it has a failure), a `TraceLine` per test, each failure with its message in a destructive `CodeBlock size="sm"` and its frames. A terminal whose output is a test run of bun test, Vitest, Jest, pytest, Gradle, Maven, go test or cargo test (`features/runs/transcript/items/test-results.tsx`, from `parseTestRun` and `testCountsText` in `@nightshift/client`). Its title says "Ran the tests · 2 failed". |
| [Stack Trace](https://ui.shadcn.com/docs/ai-elements/base/stack-trace) | An error and where it happened: a `TraceLine status="error"` with "Failed: " and the error, under it the full error and the frames on `bg-muted`, your frames in the foreground, the frames of libraries and the runtime folded behind "Show N more frames", and "Caused by" errors. A failed command or tool call whose output has a V8, Python, JVM or Go trace and is no test run (`features/runs/transcript/items/stack-trace.tsx`, from `parseStackTrace` in `@nightshift/client`). |
| [Tool](https://ui.shadcn.com/docs/ai-elements/base/tool) | Any other tool call: "Reading", "Read", "Failed to read" and what it acted on, the input and result under it. A long result opens in a Sheet with "Show all" (`features/runs/transcript/items/tool-call-row.tsx`). |
| [Checkpoint](https://ui.shadcn.com/docs/ai-elements/base/checkpoint) | A point in the conversation: a separator `Marker`. Where each agent session starts in a run's transcript: no Restore button there. In the flow chat, "Restore the flow to here" (an xs outline `Button` in the Marker) above a message whose proposal you applied puts the draft back as it was when you sent it (`features/flows/chat/chat-panel.tsx`). |
| [Confirmation](https://ui.shadcn.com/docs/ai-elements/base/confirmation) | A question to approve: an outline `Item` with an icon, title, description and the choices in `ItemActions`. An open Gate in a run's transcript (`GateConfirmation` in `features/gates`). More than two choices list under the question in the same Item. A proposed change in the flow chat, with Show on canvas, Discard and Apply (`features/flows/chat/proposal-card.tsx`). |
| [Prompt Input](https://ui.shadcn.com/docs/ai-elements/base/prompt-input) | A message box: `InputGroup` in a form, the textarea over a `block-end` addon, Enter sends, Shift+Enter is a new line, Send becomes Stop while the agent answers. The flow chat and every Suggest popover (`PromptInput` in `features/flows/assistant/prompt-input.tsx`). No attachments: a chat request cannot carry files. |
| [Model Selector](https://ui.shadcn.com/docs/ai-elements/base/model-selector) | Two `DropdownMenu`s with radio items in the Prompt Input's `block-end` addon. The agent (profiles, then a submenu of models per harness) and the effort (`AgentMenus` in `features/flows/assistant/agent-picker.tsx`). |
| [Suggestion](https://ui.shadcn.com/docs/ai-elements/base/suggestion) | Messages to send with one click: outline sm `Button`s in a row that scrolls sideways, above the Prompt Input. The starters of a new flow's chat and the quick picks of a Suggest popover (`features/flows/assistant/suggestions.tsx`). |
| Shimmer | Text that shimmers while the agent works: a `TraceLine status="running"`, whose `TraceTitle` shimmers. What the agent does now, in a flow chat answer and a Suggest popover. |

## Blocks

Blocks are whole sections and pages. `shadcn add <block>` copies the block's
files into the app; then adapt the copy. Browse them at
<https://ui.shadcn.com/blocks>.

| Block | What it is |
| --- | --- |
| `dashboard-01` | A full dashboard: sidebar, section cards with numbers and trends, an interactive area chart and a data table. The model for the home page. |
| `sidebar-01` | A simple sidebar with navigation grouped by section. |
| `sidebar-02` | A sidebar with collapsible sections. |
| `sidebar-03` | A sidebar with submenus. |
| `sidebar-04` | A floating sidebar with submenus. |
| `sidebar-05` | A sidebar with collapsible submenus. |
| `sidebar-06` | A sidebar with submenus as dropdowns. |
| `sidebar-07` | A sidebar that collapses to icons, with a team switcher and a user menu. Night Shift's app shell is based on it; its team switcher is the Space switcher (`features/spaces/space-switcher.tsx`). |
| `sidebar-08` | An inset sidebar with secondary navigation. |
| `sidebar-09` | Collapsible nested sidebars (a mail-client layout). |
| `sidebar-10` | A sidebar in a popover. |
| `sidebar-11` | A sidebar with a collapsible file tree. |
| `sidebar-12` | A sidebar with a calendar. |
| `sidebar-13` | A sidebar in a dialog (a settings dialog). |
| `sidebar-14` | A sidebar on the right. |
| `sidebar-15` | A left and a right sidebar. |
| `sidebar-16` | A sidebar with a sticky site header. |
| `login-01` … `login-05` | Login pages: a simple form, two columns with a cover image, a muted background, form with image, email only. |
| `signup-01` … `signup-05` | The same five layouts for sign-up. |
| `chart-area-*` | Area charts: default, linear, step, stacked, stacked-expand, legend, icons, gradient, axes, interactive. |
| `chart-bar-*` | Bar charts: default, horizontal, multiple, stacked, label, custom label, mixed, active, negative, interactive. |
| `chart-line-*` | Line charts: default, linear, step, multiple, dots, custom dots, colored dots, label, custom label, interactive. |
| `chart-pie-*` | Pie and donut charts: simple, separator-none, label, custom label, label list, legend, donut, donut active, donut text, stacked, interactive. |
| `chart-radar-*` | Radar charts: default, dots, lines only, multiple, legend, icons, radius, custom label, and grid variants. |
| `chart-radial-*` | Radial charts: simple, label, grid, text, shape, stacked. |
| `chart-tooltip-*` | Chart tooltip variants: default, line or no indicator, custom or no label, formatter, icons, advanced. |

## Picking the right piece

| You need | Use |
| --- | --- |
| The page frame, navigation, mobile menu | Sidebar (from `sidebar-07`) with `SidebarInset` and a header holding `SidebarTrigger` and a Breadcrumb |
| A page title with actions | A header row: `h1` + muted description + Buttons. No component needed. |
| A number with a caption | Card (`CardHeader` + `CardDescription` + `CardTitle`), as in `dashboard-01`'s section cards |
| A list of things you click into | Item in an `ItemGroup`, or Table when there are columns to compare |
| A status | Badge with an icon, colored by the status token |
| Nothing to show yet | Empty |
| A message in the page | Alert |
| A form | Field, FieldGroup, FieldSet with the matching control |
| Two or more views of one thing | Tabs, or Toggle Group for a compact switch |
| A run's transcript | message, marker and the Chain of Thought, Terminal, Test Results, Stack Trace, Tool, Reasoning, Subagent, Checkpoint and Confirmation patterns (trace, code-block, item) inside message-scroller |
| Confirm before a destructive step | Alert Dialog |
| Feedback after an action | Sonner `toast()` |
| Long content in a fixed box | Scroll Area |

Custom components are for what shadcn does not cover. In Night Shift that is
the flow canvas (React Flow nodes and edges, and the node dock of shadcn
Buttons over it) and domain wrappers that compose shadcn pieces, such as a
run-status badge. Build them from shadcn components
and theme tokens, never with a parallel set of styles.
