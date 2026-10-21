import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Input } from "@nightshift/ui-native/components/ui/input";
import { Label } from "@nightshift/ui-native/components/ui/label";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { CircleAlert, ScanQrCode } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { ENV } from "@/env";
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

	return (
		<Screen>
			<Card>
				<CardHeader>
					<CardTitle>Connect to your Host</CardTitle>
					<CardDescription>
						Sign in to the Host that runs your flows. Then you answer Gates and
						follow runs from this phone.
					</CardDescription>
				</CardHeader>
				<CardContent className="gap-4">
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
							<Field
								label="Host address"
								hint="The address where you open Night Shift in a browser. Or scan the code under Settings in Night Shift on your computer."
							>
								<Input
									value={address}
									onChangeText={setAddress}
									placeholder="nightshift.example.com"
									autoCapitalize="none"
									autoCorrect={false}
									keyboardType="url"
									textContentType="URL"
								/>
								<Button variant="outline" onPress={() => setStep("scan")}>
									<Icon as={ScanQrCode} />
									<Text>Scan the code</Text>
								</Button>
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
								/>
							</Field>
							<Field label="Password">
								<Input
									value={password}
									onChangeText={setPassword}
									secureTextEntry
									autoComplete="password"
									textContentType="password"
									onSubmitEditing={submit}
								/>
							</Field>
						</>
					) : (
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
							/>
							<Button
								variant="link"
								className="self-start px-0"
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
						</Field>
					)}
					{error ? (
						<Alert icon={CircleAlert} variant="destructive">
							<AlertTitle>You are not connected</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
					{step === "scan" ? null : (
						<Button onPress={submit} disabled={busy}>
							<Text>
								{step === "sign-in"
									? busy
										? "Connecting…"
										: "Connect"
									: busy
										? "Checking the code…"
										: "Verify code"}
							</Text>
						</Button>
					)}
				</CardContent>
			</Card>
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
			{hint ? <Text variant="muted">{hint}</Text> : null}
		</View>
	);
}
