# Phone app

The phone app is for when you are away from your computer. It tells you what needs you now. You can answer a Gate, pause tonight's runs, run a flow now, or stop a run.

You build flows and read reports on your computer. The phone shows no numbers, reports, or history.

The phone app is in a closed test. It is not in the App Store or Google Play yet.

## Connect

Your phone connects to a [Host](Computers-and-Hosts.md#run-a-host), not to your laptop. So you need a Host first.

1. Install the Night Shift app on your phone.
2. On the Host, open **Settings**. **Use Night Shift on your phone** shows a QR code and the address of the Host.
3. In the app, scan the code or type the address. Sign in with your account.
4. Allow notifications when the app asks.

## Answer a Gate

1. Tap the notification, or open the **Needs you** tab.
2. Read the question, the brief, and what each option does.
3. Choose an option. The options show in the colors of the flow.
4. Confirm your answer.

**Skip** moves a question to the end of the queue. A Gate with two options can also allow an answer from the lock screen, when its node allows it.

## The two tabs

- **Needs you** shows one thing at a time, the most urgent first. First come the Gates and Asks that wait for you. Then come the runs that stopped in the last day. For a run that stopped, choose **Retry**, **Resume**, or **Leave it**.
- **Runs** shows one list from now to tomorrow morning, for the Space that you choose at the top. **Now** shows the runs at work. **Tonight** shows each schedule at its time.

In **Runs**, swipe to act:

| Swipe | On a run | On a schedule |
| --- | --- | --- |
| Left | **Stop** | **Pause tonight**, or **Undo pause** |
| Right | | **Run now** |

On Android, touch and hold a run or a schedule for the same actions.

## More

- **Follow a run.** The run screen shows its steps, transcripts, and changed files, with **Stop**.
- **A test run** shows a **Test run** badge. A step that did not run says **Pinned output** or **Skipped**. See [Test runs](Runs-and-schedules.md#test-runs).
- **A Live Activity** follows a run on the lock screen.
- **A widget** on the home screen shows what needs you now: the Gates marked Now, and the flows that need a look. It never shows what a Gate asks.

## Notifications

A notification tells you what waits, and nothing more:

- A Gate waits for you.
- A run finished, or failed.
- A step waits for a computer that is offline.
- A schedule did not start.
- A flow needs a look, for example because it failed 2 runs in a row. Night Shift tells you once, when the problem starts.

By default, a Gate sends a notification only when its urgency is Now. To change this, see [Gates and the inbox](Gates-and-the-inbox.md). A report never sends a notification. Read reports on your computer.
