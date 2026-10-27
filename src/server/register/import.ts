/* Per-row register import orchestration; Auth provisioning is separate and safely retryable. */
import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/http/errors";
import {
  findAuthUserIdByEmail,
  provisionAccount,
} from "@/server/register/provisioning";
import {
  assertCurrentAdmin,
  callRoutine,
  type RegisterDeps,
} from "@/server/register/shared";
import type {
  ImportOutcome,
  ImportRow,
} from "@/shared/contracts/register-import";

const checkedRowSchema = z.object({
  state: z.enum(["READY", "EXISTING", "CONFLICT", "IMPORTED"]),
  accountId: z.uuid().optional(),
});

export async function importRegisterRow(
  deps: RegisterDeps,
  row: ImportRow,
  apply: boolean,
): Promise<Omit<ImportOutcome, "row">> {
  await assertCurrentAdmin(deps);
  let accountId = await findAuthUserIdByEmail(deps.admin, row.email);
  const args = () => ({
    p_identifier: row.identifier,
    p_name: row.representativeName,
    p_account_id: accountId,
    p_is_eligible: row.isEligible,
  });
  const check = async (routine: string) => {
    const parsed = checkedRowSchema.safeParse(
      await callRoutine(deps.client, routine, args()),
    );
    if (!parsed.success) throw new ApiError("INTERNAL_ERROR");
    return parsed.data;
  };
  let outcome = await check("check_register_import");
  if (apply && outcome.state === "READY") {
    await assertCurrentAdmin(deps);
    const provisioned = await provisionAccount(deps.admin, {
      email: row.email,
      representativeName: row.representativeName,
      isAdmin: false,
      actorProfileId: deps.actor.id,
    });
    accountId = provisioned.accountId;
    outcome = await check("import_register_household");
  }
  const messages = {
    READY: "Ready to import. New accounts remain suspended.",
    EXISTING: "Exact match; no changes made. Review account access separately.",
    CONFLICT:
      "Conflicts with the current register. No existing records were changed.",
    IMPORTED:
      "Imported with a suspended account. Review and enable the account separately.",
  };
  return {
    identifier: row.identifier,
    ...outcome,
    message: messages[outcome.state],
  };
}
