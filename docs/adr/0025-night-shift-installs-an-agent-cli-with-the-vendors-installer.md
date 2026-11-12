# 25. Night Shift installs an agent CLI with the vendor's installer, on this computer, after you confirm

Status: accepted, 2026-11-12. Built, 2026-11-12, in wave 2, lanes G1, G2 and G4
([the record](../research/any-domain-2026-11.md), Q12, Q22).

## Context

An Agent node runs an agent CLI: Claude Code, Codex, OpenCode, pi or a custom
agent. Night Shift finds a CLI on the PATH and checks its version and its sign-in
(`checkHarness`). It never installed one. A person had to:

1. Open a terminal.
2. Run the vendor's install command.
3. Run the CLI once to sign in.
4. Come back to the Agents page.

The check said so in terminal words: "Run `claude` once to log in." Night Shift now
serves anyone, not only developers (Q2). Q12 asks for a guided setup like "Set up
git": install one agent CLI and sign in, with no terminal. Agents stay harness
CLIs.

The vendors document a native installer for their CLI:

- Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`. It asks nothing,
  refuses sudo, and puts `claude` in `~/.local/bin`. `claude auth login` opens the
  browser, and the person may paste a code.
- Codex: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`. It uses no sudo
  and puts `codex` in `~/.local/bin`. It asks two questions unless
  `CODEX_NON_INTERACTIVE` is set. `codex login` waits for the browser.
- pi: the installer asks questions through `/dev/tty`, needs Node, and may use
  sudo. It signs in only inside its own interface.

## Decision

1. **The vendor's own installer.** Night Shift runs the command the vendor
   documents, as the person reads it on the screen. It does not use Homebrew for an
   agent: the native install updates itself and needs no administrator.
2. **Fixed data only.** Each harness record holds its setup: the install script (a
   fixed https address), the shell, extra variables, the bin folder, the sign-in
   command, the hosts a sign-in address may point at, and pipes or a terminal. No
   part of a request goes into what runs. A request names only the harness.
3. **After you confirm, on this computer.** The screen shows the exact command and
   its source before it runs. The API refuses a request from another computer. It
   refuses when Night Shift runs in a container, because the install would not
   last a restart. It refuses on a system other than macOS and Linux.
4. **Never as an administrator.** The installer runs in a session of its own, with
   no input and no terminal, so it cannot ask for a password. A timeout of 10
   minutes stops it and every program it started. A failed install keeps the end
   of its output for the details.
5. **The CLI signs itself in.** Night Shift runs the CLI's own sign-in command.
   The CLI opens the browser. Night Shift reads the output only for the sign-in
   address on a vendor host and for a question that asks for a code. It sends a
   pasted code to the CLI. It never stores or logs the output. A sign-in signs in
   the CLI's default account, so the person's own use of the CLI shares it.
6. **Then a profile.** After a sign-in, Night Shift checks the CLI again. That
   check notes `agent.checked`, so no new usage event is needed. It adds the
   harness and an Agent Profile on it, as "Set up" does for a found program. A
   harness with a profile keeps it. The profile takes the `agentPermissionMode`
   setting.
7. **The PATH.** The desktop app and the `nightshift` binary put `~/.local/bin`
   first on the PATH when the folder exists and the PATH lacks it. The setup does
   the same after an install.
8. **Version 1 is Claude Code and Codex.** pi stays "found and added" until its
   installer and its sign-in work without a terminal.

## Alternatives

- **A command for the person to run (the "Set up git" way on Linux).** No risk on
  Night Shift's side, but the person still needs a terminal. Q12 asks for none.
- **Homebrew for every agent.** One package manager on a Mac. But the cask does not
  update itself, it is absent on Linux and on many Macs, and it can ask for an
  administrator password.
- **A terminal emulator in the window.** It shows everything the CLI prints. But
  the person sees a terminal, and the UI copy rules ask for plain words. A
  terminal of its own (Bun's `terminal` option) stays behind a flag per harness,
  for a CLI that refuses to sign in without one.
- **Night Shift's own sign-in.** Night Shift would keep the vendor's tokens. The CLI
  already keeps them in the Keychain or its own folder, so a second copy adds risk
  and nothing else.

## Consequences

- Night Shift downloads and runs code from the vendor's server. The address is
  fixed and https, and the person confirms first. `SECURITY.md` says so.
- A reload or a restart of Night Shift stops an install or a sign-in that runs. The
  person checks again.
- The Codex installer adds `~/.local/bin` to a shell profile only when the PATH
  lacks it. Night Shift's own PATH often has it already, so the person's terminal
  may not find `codex`. Night Shift finds it.
- A second account per CLI (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) and signing in a
  Host (`claude setup-token`) come later.
- Whether each CLI signs in with plain pipes is not proven on a real sign-in yet.
  The owner checks it by hand (lane G1 notes). A CLI that needs a terminal switches
  its `signInIo` to `terminal`.
