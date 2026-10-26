// Bounded public support payload; no attachments, ballots or account credentials.
import { z } from "zod";

export const contactSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  message: z.string().trim().min(10).max(5000),
});

export type ContactMessage = z.output<typeof contactSchema>;
