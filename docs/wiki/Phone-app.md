# Phone app

The phone app is the night watch. You draw and change flows on your computer. On the phone you follow your runs and answer what waits for you.

The phone app is in a closed test. It is not in the App Store or Google Play yet.

## Connect

Your phone needs a [Host](Computers-and-Hosts.md#run-a-host).

1. Install the Night Shift app on your phone.
2. On the Host, open Settings. **Use Night Shift on your phone** shows a QR code and the address of the Host.
3. In the app, scan the code or type the address. Sign in with your account.
4. Allow notifications when the app asks.

## What it does

| Tab | Shows |
| --- | --- |
| **Watch** | What needs you, how your latest day of runs went, the latest reports, and what runs now. Pause tonight's schedules, or run one now. |
| **Needs you** | The Gates and Asks that wait, with their count. |
| **Runs** | The runs, their steps, reports, transcripts, and changed files. |

- **Answer** a Gate, or a simple Ask.
- **Read a report.** A run can end with a report from its End node. The run screen shows its start. Tap **Read all** to read all of it, and select text to copy it. A picture in a report shows as a link.
- **Start a flow** with its inputs.
- **A test run** shows a **Test run** badge. A step whose node did not run says **Pinned output** or **Skipped**. The phone does not ask if a test run was useful. See [Test runs](Runs-and-schedules.md#test-runs).
- **The counts leave test runs out.** The chips of **Runs** and the numbers of **Watch** do not count them. The cost of the day counts them, and says how many it holds: "Of 8 runs and 1 test run". **Watch** shows the latest day with a run that is not a test run.
- **The lock screen.** Approve or reject a Gate with two options, when its node allows it.
- **A Live Activity** follows a run on the lock screen.
- **A widget** shows on the home screen how many Gates wait and how your latest runs went. A test run there says **Test run** after its status.

## Notifications

A push tells you what waits, and nothing more:

- A Gate waits for you.
- A run finished, or failed.
- A step waits for a computer that is offline.
- A schedule did not start.

A report never sends a push. **Latest reports** on Watch shows the newest report of up to three flows from the last 7 days.
