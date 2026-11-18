import { router, Stack } from "expo-router";
import { CircleAlert, ScanQrCode } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ENV } from "@/env";
import {
	NativeButtonRow,
	type NativeFieldHandle,
	NativeList,
	NativeRow,
	NativeSection,
	NativeTextFieldRow,
	NativeTextRow,
} from "@/shared/native-list";
import { CodeScanner } from "./code-scanner";
import { type CodeKind, useHost } from "./host-provider";

type Step = "sign-in" | "scan" | "code";

const RED = "#dc2626";

/**
 * Connect this phone to a Host: its address (typed, or scanned from the
 * code in Night Shift's Settings), the person's email and password, and a
 * two-factor code or a backup code when the Host asks for one. A native
 * grouped list: SwiftUI form rows on iOS, Material 3 fields on Android.
 * The list keeps the field you type in above the keyboard.
 */
export function ConnectScreen() {
	const { state, signIn, verifyCode } = useHost();
	const [step, setStep] = useState<Step>("sign-in");
	const [codeKind, setCodeKind] = useState<CodeKind>("app");
	const [address, setAddress] = useState(
		(state.status === "signed-out" && state.address) ||
			ENV.EXPO_PUBLIC_DEFAULT_HOST ||
			"",
	);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	/** The sign-in went through: leave once the app knows it too. */
	const [connected, setConnected] = useState(false);
	const passwordField = useRef<NativeFieldHandle>(null);

	// Back to the tabs that wait under this screen, or to new ones. Only once
	// the Host state says signed in: the session reaches it a render later
	// than `signIn` resolves, and tabs that still read "signed out" send the
	// person straight back here.
	useEffect(() => {
		if (connected && state.status === "signed-in") router.dismissTo("/");
	}, [connected, state.status]);

	const waiting = busy || connected;

	async function submit() {
		// The return key can send the form again while it is on its way.
		if (waiting) return;
		setBusy(true);
		setError(null);
		try {
			if (step !== "code") {
				const result = await signIn({ address, email, password });
				if (result === "needs-code") {
					setStep("code");
					return;
				}
			} else {
				await verifyCode(code, codeKind);
			}
			setConnected(true);
		} catch (failed) {
			setError(failed instanceof Error ? failed.message : String(failed));
		} finally {
			setBusy(false);
		}
	}

	const submitLabel =
		step === "sign-in"
			? waiting
				? "Connecting…"
				: "Connect"
			: waiting
				? "Checking the code…"
				: "Verify code";

	const problem = error ? (
		<NativeSection>
			<NativeTextRow
				icon={{ sf: "exclamationmark.triangle.fill", lucide: CircleAlert }}
				iconColor={RED}
				text="**You are not connected**"
				note={error}
			/>
		</NativeSection>
	) : null;

	return (
		<>
			<Stack.Screen
				options={{
					title: step === "code" ? "Second code" : "Connect",
				}}
			/>
			<NativeList>
				{step === "scan" ? (
					<CodeScanner
						onScanned={(scanned) => {
							setAddress(scanned);
							setError(null);
							setStep("sign-in");
						}}
						onCancel={() => setStep("sign-in")}
					/>
				) : step === "sign-in" ? (
					<>
						<NativeSection footer="Sign in to the Host that runs your flows. Then answer Gates and follow runs from this phone.">
							<NativeRow
								icon={{ sf: "qrcode.viewfinder", lucide: ScanQrCode }}
								title="Scan the code"
								subtitle="In Night Shift on your computer, under Settings"
								onPress={() => setStep("scan")}
								accessibilityLabel="Scan the code. Opens the camera to read the Host address."
							/>
						</NativeSection>
						<NativeSection
							title="Or sign in by hand"
							footer="The Host address is where you open Night Shift in a browser."
						>
							<NativeTextFieldRow
								label="Host address"
								kind="url"
								value={address}
								onChange={setAddress}
								placeholder="nightshift.example.com"
							/>
							<NativeTextFieldRow
								label="Email"
								kind="email"
								value={email}
								onChange={setEmail}
								placeholder="you@example.com"
								returnKey="next"
								onSubmit={() => passwordField.current?.focus()}
							/>
							<NativeTextFieldRow
								ref={passwordField}
								label="Password"
								kind="password"
								value={password}
								onChange={setPassword}
								placeholder="Required"
								returnKey="go"
								onSubmit={() => void submit()}
							/>
						</NativeSection>
						{problem}
						<NativeSection>
							<NativeButtonRow
								label={submitLabel}
								disabled={waiting}
								onPress={() => void submit()}
							/>
						</NativeSection>
					</>
				) : (
					<>
						<NativeSection
							footer={
								codeKind === "app"
									? "Your Host asks for a second code before you sign in. Enter the 6-digit code from your authenticator app."
									: "Your Host asks for a second code before you sign in. Enter one of the backup codes you saved. Each code works once."
							}
						>
							<NativeTextFieldRow
								label={codeKind === "app" ? "Two-factor code" : "Backup code"}
								kind={codeKind === "app" ? "one-time-code" : "code"}
								value={code}
								onChange={setCode}
								placeholder={codeKind === "app" ? "123456" : "abcde-fghij"}
								returnKey="go"
								onSubmit={() => void submit()}
							/>
						</NativeSection>
						{problem}
						<NativeSection>
							<NativeButtonRow
								label={submitLabel}
								disabled={waiting}
								onPress={() => void submit()}
							/>
							<NativeButtonRow
								label={
									codeKind === "app"
										? "Use a backup code"
										: "Use the code from your app"
								}
								disabled={waiting}
								onPress={() => {
									setCode("");
									setError(null);
									setCodeKind(codeKind === "app" ? "backup" : "app");
								}}
							/>
						</NativeSection>
					</>
				)}
			</NativeList>
		</>
	);
}
