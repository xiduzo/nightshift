# Start a flow from another tool

A schedule can start its flow when a webhook arrives. Then any tool that
sends an HTTP request starts a run: GitHub Actions, n8n, Make, Zapier,
Kestra, Windmill, Cursor automations, or a script of your own. You need no
connector for each tool.

Tested here: the `curl` example below, against a running Night Shift. A
unit test checks its signature (`packages/engine/src/schedules/webhooks.test.ts`).
The GitHub Actions workflow follows GitHub's documentation. Nobody tested it
here end to end.

## 1. Make a webhook schedule

1. Make a long random secret, for example with `openssl rand -hex 32`.
2. In Night Shift, add it on the **Secrets** page, for example as
   `NIGHTSHIFT_HOOK_SECRET`. On a Host without a screen, an environment
   variable of the same name also works.
3. Open the project's **Schedules** page and choose **New schedule**.
4. Choose **When a webhook arrives** and the flow to start.
5. In **Secret**, type the secret's name: `NIGHTSHIFT_HOOK_SECRET`.
6. Give the flow's inputs values that read the webhook, for example
   `{{event.body.ref}}`. `event.body` is the body you send.
   `event.headers` holds its headers.
7. Optional: in **Only when**, give a JSONata rule. Night Shift skips each
   webhook that does not match the rule. Example:
   `event.body.event = "pull_request"`.
8. Copy the **Address**. It looks like
   `https://nightshift.example.com/hooks/<project id>/<schedule id>`.

The computer that starts your schedules takes the webhooks. That is the
Host of the Space, or your one computer when the Space has no Host. The
sender must reach its address. [Night Shift from anywhere](README.md) shows
the ways to give a Host an `https://` address.

A webhook schedule can also wake the runs that wait for a signal, with or
without a new run. Turn on **Wake waiting runs** and give the signal's
name. A Wait node that waits for that name then continues, with the
webhook as its data. Use it to let a run wait until CI is done.

## 2. Prove that you know the secret

Night Shift takes a webhook only from a sender that knows the schedule's
secret. Send one of these headers:

| Header | What it proves | Use it when |
| --- | --- | --- |
| `X-Hub-Signature-256: sha256=<signature>` | The sender knows the secret, and nobody changed the body on the way. | You can run a script, as in GitHub Actions or `curl`. |
| `Authorization: Bearer <secret>` | The sender knows the secret. | The tool cannot compute a signature. Send it over `https://` only. |

The signature is the HMAC-SHA256 of the exact bytes of the body, with the
secret as the key, in lowercase hex. GitHub signs its own webhooks the same
way. When a request has both headers, Night Shift checks the signature.

## 3. Send a signed webhook with curl

```bash
URL="https://nightshift.example.com/hooks/<project id>/<schedule id>"
SECRET="the value of NIGHTSHIFT_HOOK_SECRET"
BODY='{"event":"workflow_dispatch","ref":"main"}'

SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  --data "$BODY"
```

Sign the bytes that you send, and nothing else. `printf '%s'` adds no
newline. To send a file, use `--data-binary @body.json`. `--data @file`
removes the newlines, and then the signature does not match.

To check your script: with the secret `s3cret` and the body above, the
header is
`X-Hub-Signature-256: sha256=c98cccfa6a826fa62986e44f9d6f1415f5cda15491c5e96a1f29f8bd1e9fcba5`.

Without a signature:

```bash
curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  --data "$BODY"
```

Night Shift answers at once. The run starts after the answer.

| Answer | What it means |
| --- | --- |
| `202 {"result":"accepted"}` | The run starts, or the signal goes to the waiting runs. |
| `202 {"result":"filtered"}` | The **Only when** rule does not hold for this webhook. Nothing starts. |
| `404 {"message":"Not found."}` | The address is wrong, or the secret does not match. Night Shift gives one answer for both, so nobody learns which schedules exist. On the Schedules page, the schedule shows its last webhook and why Night Shift refused it. |
| `409 {"message":"…"}` | The secret matched, but the schedule takes no webhook now. The message says why: the schedule is paused, schedules are paused, or another computer takes this webhook. |
| `413` | The body is larger than 1 MiB. |

## 4. Start a flow from GitHub Actions

This workflow starts the flow when a pull request opens or changes. It also
starts the flow when you click **Run workflow** in GitHub.

1. In GitHub, open **Settings → Secrets and variables → Actions**.
2. Add two repository secrets:

   - `NIGHTSHIFT_HOOK_URL`: the schedule's address.
   - `NIGHTSHIFT_HOOK_SECRET`: the value of the secret.

3. Save this workflow as `.github/workflows/nightshift.yml`:

```yaml
name: Night Shift

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      task:
        description: What Night Shift works on
        required: false
        default: ""

jobs:
  start:
    runs-on: ubuntu-latest
    steps:
      - name: Start the Night Shift flow
        env:
          URL: ${{ secrets.NIGHTSHIFT_HOOK_URL }}
          SECRET: ${{ secrets.NIGHTSHIFT_HOOK_SECRET }}
          EVENT: ${{ github.event_name }}
          REPOSITORY: ${{ github.repository }}
          REF: ${{ github.head_ref || github.ref_name }}
          PR: ${{ github.event.pull_request.number }}
          TITLE: ${{ github.event.pull_request.title }}
          TASK: ${{ inputs.task }}
        run: |
          BODY=$(jq -cn \
            --arg event "$EVENT" --arg repository "$REPOSITORY" --arg ref "$REF" \
            --arg pr "$PR" --arg title "$TITLE" --arg task "$TASK" \
            '{event: $event, repository: $repository, ref: $ref, pr: $pr, title: $title, task: $task}')
          SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
          curl -sS --fail-with-body -X POST "$URL" \
            -H "Content-Type: application/json" \
            -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
            --data "$BODY"
```

- The values come in through `env`, not in the script itself. Thus a pull
  request title cannot run as a command.
- `jq` makes the body, so a quote in a title does not break the JSON.
  The `ubuntu-latest` runner has `jq`, `openssl` and `curl`.
- `--fail-with-body` fails the job when Night Shift refuses the webhook,
  and shows why.
- A pull request from a fork gets no repository secrets, so the step
  fails there. That is GitHub's protection. Do not avoid it with
  `pull_request_target`.

On the schedule, give the flow's inputs values such as `{{event.body.ref}}`,
`{{event.body.pr}}` and `{{event.body.task}}`. To start only for pull
requests, set **Only when** to `event.body.event = "pull_request"`.

GitHub can also send its own webhooks, without a workflow:

1. In the repository, open **Settings → Webhooks**.
2. Paste the address as the payload URL.
3. Choose `application/json`.
4. Give the secret's value.

The body is then GitHub's event, for example
`{{event.body.pull_request.number}}`. `event.headers."x-github-event"` says
which event it is. Use the workflow when you want **Run workflow** with
inputs, a start after your CI passes, or a body that you choose.

## 5. n8n, Make, Zapier and others

Each of these tools has a step that sends an HTTP request. Configure it
like this:

- Method: `POST`.
- URL: the schedule's address.
- Header: `Content-Type: application/json`.
- Header: `Authorization: Bearer <secret>`. Keep the secret in the tool's
  own store of credentials, not in the step itself.
- Body: JSON with the values your flow needs, for example
  `{"task": "Fix the login", "ref": "main"}`.

A tool that can compute an HMAC can sign the body instead: n8n's Crypto
node, a code step in Make or Zapier, a script in Kestra or Windmill. Sign
the exact body that the next step sends, as in the `curl` example.

To follow the run, and to answer its Gates from an agent, see
[Drive Night Shift from a terminal or an agent](../../README.md#drive-night-shift-from-a-terminal-or-an-agent).
