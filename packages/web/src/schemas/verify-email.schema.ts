import { z } from "zod";

export const verifyEmailSchema = z.object({
  otp: z
    .string()
    .trim()
    .length(6, "Enter the 6-digit code")
    .regex(/^\d+$/, "Code must be numeric"),
});

export type VerifyEmailFormValues = z.infer<typeof verifyEmailSchema>;
