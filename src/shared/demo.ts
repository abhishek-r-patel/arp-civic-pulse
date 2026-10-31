/*
 * Fictional demo sign-in identities (docs/OPERATIONS.md, "Demo site"). Shared
 * by the demo sign-in route and the `demo-reset` seed so both always agree.
 * Every visitor shares each persona, and the demo accepts their changes until
 * the next reset. The `example.com` addresses are reserved for documentation
 * and never receive mail; the demo never sends email anyway.
 */
import { z } from "zod";

export const DEMO_PERSONAS = {
  resident: {
    email: "demo-resident@example.com",
    name: "Asha Demo",
    label: "Sign in as a sample resident",
    description:
      "See open votes, how a ballot looks and published results, as a resident would.",
  },
  committee: {
    email: "demo-committee@example.com",
    name: "Ravi Demo",
    label: "Sign in as a sample committee member",
    description:
      "Look around the administration screens with view-only access: residents, votes, settings and audit history.",
  },
  admin: {
    email: "demo-admin@example.com",
    name: "Sunita Demo",
    label: "Sign in as a sample RWA admin",
    description:
      "Run the association: create, schedule, start and close votes, and manage residents and settings.",
  },
} as const;

export type DemoPersona = keyof typeof DEMO_PERSONAS;

export const DEMO_PERSONA_KEYS = Object.keys(DEMO_PERSONAS) as [
  DemoPersona,
  ...DemoPersona[],
];

export const demoSessionSchema = z.strictObject({
  persona: z.enum(DEMO_PERSONA_KEYS),
});
