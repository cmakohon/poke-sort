import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { neon } from "@/lib/auth/client";
import {
  verifyEmailSchema,
  type VerifyEmailFormValues,
} from "@/schemas/verify-email.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconLoader2, IconMailCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const { data, refetch } = neon.auth.useSession();
  const email = data?.user?.email;
  const emailVerified = data?.user?.emailVerified;
  const [isResending, setIsResending] = useState(false);

  const form = useForm<VerifyEmailFormValues>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: { otp: "" },
  });

  useEffect(() => {
    if (emailVerified) navigate("/app", { replace: true });
  }, [emailVerified, navigate]);

  const handleVerify = async ({ otp }: VerifyEmailFormValues) => {
    if (!email) return;
    try {
      const { error } = await neon.auth.emailOtp.verifyEmail({ email, otp });
      if (error) throw error;
      toast.success("Email verified");
      await refetch();
      navigate("/app", { replace: true });
    } catch (error) {
      form.setError("otp", {
        message:
          error instanceof Error ? error.message : "Invalid or expired code",
      });
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setIsResending(true);
    try {
      await neon.auth.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      toast.success("Verification code sent", {
        description: `Check ${email} for a new code.`,
      });
    } catch {
      toast.error("Couldn't send verification code");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            <IconMailCheck className="size-5 text-primary" />
            <CardTitle>Verify your email</CardTitle>
          </div>
          <CardDescription>
            Enter the 6-digit code we sent to {email ?? "your email address"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={form.handleSubmit(handleVerify)}
            className="flex flex-col gap-4"
          >
            <Controller
              name="otp"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="otp">Verification code</FieldLabel>
                  <InputOTP
                    id="otp"
                    maxLength={6}
                    autoComplete="one-time-code"
                    aria-invalid={fieldState.invalid}
                    autoFocus
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    containerClassName="cn-input-otp flex items-center has-disabled:opacity-50 w-full"
                  >
                    <InputOTPGroup className="w-full">
                      <InputOTPSlot index={0} className="h-10 flex-1" />
                      <InputOTPSlot index={1} className="h-10 flex-1" />
                      <InputOTPSlot index={2} className="h-10 flex-1" />
                      <InputOTPSlot index={3} className="h-10 flex-1" />
                      <InputOTPSlot index={4} className="h-10 flex-1" />
                      <InputOTPSlot index={5} className="h-10 flex-1" />
                    </InputOTPGroup>
                  </InputOTP>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="w-full"
            >
              {form.formState.isSubmitting && (
                <IconLoader2 className="size-4 animate-spin" />
              )}
              Verify email
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleResend}
              disabled={isResending}
              className="w-full"
            >
              {isResending && <IconLoader2 className="size-4 animate-spin" />}
              Resend code
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
