import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Input } from "@nightshift/ui-native/components/ui/input";
import { Label } from "@nightshift/ui-native/components/ui/label";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { CircleAlert, ScanQrCode } from "lucide-react-native";
import { type ReactNode, useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { ENV } from "@/env";
import { LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { CodeScanner } from "./code-scanner";
import { type CodeKind, useHost } from "./host-provider";

type Step = "sign-in" | "scan" | "code";

/**
 * Connect this phone to a Host: its address (typed, or scanned from the
 * code in Night Shift's Settings), the person's email and password, and a
 * two-factor code or a backup code when the Host asks for one.
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
	const passwordInput = useRef<TextInput>(null);

	async function submit() {
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
			router.replace("/");
		} catch (failed) {
			setError(failed instanceof Error ? failed.message : String(failed));
		} finally {
			setBusy(false);
		}
	}

	const submitLabel =
		step === "sign-in"
			? busy
				? "Connecting…"
				: "Connect"
			: busy
				? "Checking the code…"
				: "Verify code";

	return (
		<Screen>
			<LargeTitleHeader
				title={
					step === "code" ? "Check that it is you" : "Connect to your Host"
				}
				summary={
					step === "code"
						? "Your Host asks for a second code before you sign in."
						: "Sign in to the Host that runs your flows. Then you answer Gates and follow runs from this phone."
				}
			/>
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
					<ListGroup>
						<ListRow
							icon={ScanQrCode}
							title="Scan the code"
							caption="In Night Shift on your computer, under Settings"
							onPress={() => setStep("scan")}
							accessibilityHint="Opens the camera to read the Host address"
						/>
					</ListGroup>
					<SectionHead
						title="Or sign in by hand"
						hint="Type the Host address, your email and your password."
					/>
					<Card className="py-4">
						<CardContent className="gap-5 px-4">
							<Field
								label="Host address"
								hint="The address where you open Night Shift in a browser."
							>
								<Input
									value={address}
									onChangeText={setAddress}
									placeholder="nightshift.example.com"
									autoCapitalize="none"
									autoCorrect={false}
									keyboardType="url"
									textContentType="URL"
									accessibilityLabel="Host address"
								/>
							</Field>
							<Field label="Email">
								<Input
									value={email}
									onChangeText={setEmail}
									placeholder="you@example.com"
									autoCapitalize="none"
									autoComplete="email"
									keyboardType="email-address"
									textContentType="emailAddress"
									returnKeyType="next"
									submitBehavior="submit"
									onSubmitEditing={() => passwordInput.current?.focus()}
									accessibilityLabel="Email"
								/>
							</Field>
							<Field label="Password">
								<Input
									ref={passwordInput}
									value={password}
									onChangeText={setPassword}
									secureTextEntry
									autoComplete="password"
									textContentType="password"
									returnKeyType="go"
									onSubmitEditing={submit}
									accessibilityLabel="Password"
								/>
							</Field>
						</CardContent>
					</Card>
				</>
			) : (
				<Card className="py-4">
					<CardContent className="gap-3 px-4">
						<Field
							label={codeKind === "app" ? "Two-factor code" : "Backup code"}
							hint={
								codeKind === "app"
									? "Enter the 6-digit code from your authenticator app."
									: "Enter one of the backup codes you saved when you turned on two-factor sign-in. Each code works once."
							}
						>
							<Input
								value={code}
								onChangeText={setCode}
								placeholder={codeKind === "app" ? "123456" : "abcde-fghij"}
								autoCapitalize="none"
								autoCorrect={false}
								autoComplete={codeKind === "app" ? "one-time-code" : "off"}
								keyboardType={codeKind === "app" ? "number-pad" : "default"}
								textContentType={codeKind === "app" ? "oneTimeCode" : "none"}
								onSubmitEditing={submit}
								accessibilityLabel={
									codeKind === "app" ? "Two-factor code" : "Backup code"
								}
							/>
						</Field>
						<Button
							variant="link"
							className="h-11 self-start px-0"
							onPress={() => {
								setCode("");
								setError(null);
								setCodeKind(codeKind === "app" ? "backup" : "app");
							}}
						>
							<Text>
								{codeKind === "app"
									? "Use a backup code"
									: "Use the code from your app"}
							</Text>
						</Button>
					</CardContent>
				</Card>
			)}
			{error ? (
				<Alert icon={CircleAlert} variant="destructive">
					<AlertTitle>You are not connected</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			{step === "scan" ? null : (
				<Button size="lg" onPress={submit} disabled={busy}>
					<Text>{submitLabel}</Text>
				</Button>
			)}
		</Screen>
	);
}

/** A label, its control and an optional hint: the shadcn Field, in parts. */
function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<View className="gap-2">
			<Label>{label}</Label>
			{children}
			{hint ? (
				<Text variant="muted" className="text-muted-foreground">
					{hint}
				</Text>
			) : null}
		</View>
	);
}
