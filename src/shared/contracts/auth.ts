import { z } from "zod";
import { emailAddress, otpCode } from "@/shared/validation/primitives";

// Registration state is never encoded in these contracts (no enumeration).
export const requestCodeSchema = z.strictObject({ email: emailAddress });

export const verifyCodeSchema = z.strictObject({
  email: emailAddress,
  code: otpCode,
});

export const signOutSchema = z.strictObject({});

// Matches the Auth resend cooldown configured in supabase/config.toml
// ([auth.email] max_frequency); keep the two in step.
export const CODE_RESEND_SECONDS = 60;

export const CODE_REQUEST_MESSAGE =
  "If this address can sign in, a code may arrive shortly. If it does not, wait before requesting another code or contact the administrator.";
