# Terminal and MCP

A person or an agent in a terminal reads and saves flows through `nightshift`, never as files. Night Shift must run on this computer.

## Get the command

- The Docker image has `nightshift` on its PATH.
- From a clone, run `bun <clone>/apps/server/src/cli.ts` where this page says `nightshift`.

To make it short, run this once in the clone, or add the alias to your shell profile:

```bash
alias nightshift="bun $PWD/apps/server/src/cli.ts"
```

## Commands

<!-- generated:cli: bun run docs:reference writes this from `nightshift help`. Do not edit it here. -->
```text
Night Shift

Usage:
  nightshift serve [options]                Run Night Shift on this computer.
  nightshift join <host-address> [--guest]  Pair this computer with a Host.
  nightshift pair <code> [--yes]            Allow a computer to pair with this Host.
  nightshift merge [--dry-run] [--yes]      Merge the Personal of this computer into
                                            the Personal of its home Host. It shows
                                            what moves and asks first.
  nightshift leave [--yes]                  Leave the home Host of this computer. The
                                            Host keeps everything. This computer keeps
                                            its own Personal. It asks first.
  nightshift admin --email <email>          Set how the Host admin signs in from
                                            another computer. --reset-two-factor
                                            also turns two-factor sign-in off.
  nightshift mcp [--project <project>]     Serve the flow tools to an agent in a terminal
                                            (MCP on stdio). Night Shift must run here.
                                            Claude Code: claude mcp add nightshift -- nightshift mcp
  nightshift flows <action> [options]       Read and save the flows of a project:
                                            list, get, save, export, import,
                                            revisions, revision.
                                            nightshift flows --help for the details.
  nightshift health [--restart]             Exit code 0 when Night Shift runs here, else 1.
                                            --restart stops a Night Shift that does not
                                            respond, so that its service manager starts it
                                            again. --data-dir as for serve.

Options of serve (each has an environment variable too):
  --port <port>            The port. PORT, default 3000.
  --data-dir <folder>      Where the database and the run history go. NIGHTSHIFT_DATA_DIR.
  --host-address <url>     Be a Host at this https:// address. Repeat it for each
                           address, in the order other computers try them.
                           NIGHTSHIFT_HOST_ADDRESSES (comma-separated).
  --listen <ip>            Where a Host listens. NIGHTSHIFT_LISTEN, default 0.0.0.0.
                           Use 127.0.0.1 behind Tailscale Serve, a tunnel or a proxy.
  --tls-port <port>        The https:// port with NIGHTSHIFT_TLS_CERT and _KEY.
                           NIGHTSHIFT_TLS_PORT, default the port + 443.
  --web <folder>           Serve the web UI from this folder. NIGHTSHIFT_WEB_DIR.
  --require-two-factor     People who sign in from another computer must use
                           two-factor sign-in. NIGHTSHIFT_REQUIRE_TWO_FACTOR=on.

The auth secret is BETTER_AUTH_SECRET, else the file BETTER_AUTH_SECRET_FILE,
else BETTER_AUTH_SECRET in NIGHTSHIFT_SECRETS_DIR or systemd's credentials,
else one Night Shift makes once in the data folder.
```
<!-- /generated:cli -->

## Flows

Night Shift checks each save and keeps it as a new revision of the flow.

```bash
nightshift flows list                        # name, steps, errors, description
nightshift flows get fix-issue > fix.json    # the flow as JSON
nightshift flows save fix-issue fix.json     # or from stdin, and prints its problems
nightshift flows export fix-issue --out ./   # a file to import elsewhere
nightshift flows import fix-issue.json       # a new flow, and a taken name gets a suffix
nightshift flows revisions fix-issue         # who saved what, newest first
nightshift flows revision fix-issue <id>     # one earlier revision as JSON
```

The commands use the project of the current folder.

<!-- generated:cli-flows: bun run docs:reference writes this from `nightshift flows --help`. Do not edit it here. -->
```text
Usage:
  nightshift flows list [--json]              The flows of the project: name, steps,
                                              errors and description, one per line.
  nightshift flows get <name> [--out <file>]  The flow as JSON.
  nightshift flows save <name> [<file>]       Save the flow of the file (else of stdin)
                                              as <name>: a new flow, or a new revision.
  nightshift flows export <name> [--out <file or folder>]
                                              The flow as a file to import elsewhere.
  nightshift flows import <file> [--name <name>]
                                              Save the flow of the file as a new flow.
                                              A name the project has gets a suffix.
                                              Prints the name it got.
  nightshift flows revisions <name> [--json]  The revisions of the flow, newest first.
  nightshift flows revision <name> <id> [--out <file>]
                                              One revision of the flow as JSON.

Options:
  --project <id, name or folder>  The project. Default: the project of this folder.
  --daemon <address>              Where Night Shift runs. NIGHTSHIFT_DAEMON_URL,
                                  default http://localhost:$PORT.
```
<!-- /generated:cli-flows -->

## MCP for an agent

`nightshift mcp` gives an agent the same flows, the runs of a night, and a project's knowledge as MCP tools. The agent can be Claude Code, Codex, or an orchestrator.

Add it to Claude Code:

```bash
claude mcp add nightshift -- nightshift mcp
```

From a clone, put the full `bun` command after `--`.

<!-- checked:mcp-tools: every tool of nightshift mcp has a row. bun run docs:reference checks it. -->
| Tool | What it does |
| --- | --- |
| `list_projects`, `list_flows`, `get_flow` | Read the projects and their flows. |
| `list_profiles`, `list_tools`, `list_skills` | Look up the names that a node may use. |
| `check_flow`, `save_flow` | Check a flow, and save it when it has no errors. |
| `start_run` | Start a saved flow with its inputs. |
| `list_runs` | The newest runs, by status and since a time. Each with its cost and pull request. |
| `get_run` | One run: its status, cost, pull request, steps, and why it failed. |
| `stop_run` | Stop a run now, or after the step that runs now. |
| `needs_me` | The Gates that wait for you, in every project, with the question and the options. |
| `answer_gate` | Answer a Gate with one of its options and a note. The run continues. |
| `get_digest` | What happened since a time: the runs that ended, and the Gates that wait. |
| `search_knowledge` | Search the project's knowledge by keyword, and by meaning when Ollama runs. Gives the best files, each with its path, section, and an excerpt. |
| `read_knowledge` | Read one file of the knowledge by its path. |
<!-- /checked:mcp-tools -->

The knowledge files are also MCP resources.

## Webhooks

To start a flow from another tool, such as GitHub Actions, n8n, or Zapier, send a webhook to a schedule. See [Webhooks](Runs-and-schedules.md#webhooks).
