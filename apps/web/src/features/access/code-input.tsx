import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@nightshift/ui/components/input-otp";

/** The six digits an authenticator app shows. */
export const CODE_LENGTH = 6;

/**
 * The code from an authenticator app: six boxes, digits only. `onComplete`
 * fires when the sixth digit is in, so a pasted code submits at once.
 */
export function CodeInput({
	id,
	value,
	onChange,
	onComplete,
	invalid,
	disabled,
	autoFocus,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	onComplete?: (value: string) => void;
	invalid?: boolean;
	disabled?: boolean;
	autoFocus?: boolean;
}) {
	return (
		<InputOTP
			id={id}
			maxLength={CODE_LENGTH}
			pattern="^[0-9]+$"
			inputMode="numeric"
			autoComplete="one-time-code"
			value={value}
			onChange={onChange}
			onComplete={onComplete}
			disabled={disabled}
			autoFocus={autoFocus}
			aria-invalid={invalid || undefined}
		>
			<InputOTPGroup>
				<InputOTPSlot index={0} aria-invalid={invalid || undefined} />
				<InputOTPSlot index={1} aria-invalid={invalid || undefined} />
				<InputOTPSlot index={2} aria-invalid={invalid || undefined} />
			</InputOTPGroup>
			<InputOTPSeparator />
			<InputOTPGroup>
				<InputOTPSlot index={3} aria-invalid={invalid || undefined} />
				<InputOTPSlot index={4} aria-invalid={invalid || undefined} />
				<InputOTPSlot index={5} aria-invalid={invalid || undefined} />
			</InputOTPGroup>
		</InputOTP>
	);
}
