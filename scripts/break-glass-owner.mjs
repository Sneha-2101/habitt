import readline from "readline";
import { pathToFileURL } from "url";
import { PrismaClient } from "@prisma/client";

const LOWEST_ROLE = "CUSTOMER";

export function validateEmail(raw) {
  if (typeof raw !== "string") {
    throw new Error("Email must be a string.");
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`Invalid email address: ${raw}`);
  }
  return normalized;
}

export function parseArgs(argv) {
  let email;
  let demoteEmail;
  let apply = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--email") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--email requires a value.");
      }
      email = validateEmail(next);
      i += 1;
    } else if (arg.startsWith("--email=")) {
      email = validateEmail(arg.slice("--email=".length));
    } else if (arg === "--demote-email") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--demote-email requires a value.");
      }
      demoteEmail = validateEmail(next);
      i += 1;
    } else if (arg.startsWith("--demote-email=")) {
      demoteEmail = validateEmail(arg.slice("--demote-email=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!email) {
    throw new Error("Missing required --email <address> argument.");
  }

  if (demoteEmail && demoteEmail === email) {
    throw new Error("--demote-email must differ from --email.");
  }

  return { email, demoteEmail, apply };
}

export function planBreakGlass(users, args, allowlistRows = []) {
  const targetEmail = validateEmail(args.email);
  const demoteEmail = args.demoteEmail ? validateEmail(args.demoteEmail) : undefined;

  if (demoteEmail && demoteEmail === targetEmail) {
    return {
      ok: false,
      error: "Target and demote email must be different accounts.",
    };
  }

  const targetMatches = users.filter(
    (u) => typeof u.email === "string" && u.email.trim().toLowerCase() === targetEmail
  );
  if (targetMatches.length === 0) {
    return { ok: false, error: `Target user not found: ${targetEmail}` };
  }
  if (targetMatches.length > 1) {
    return { ok: false, error: `Ambiguous target user match for: ${targetEmail}` };
  }
  const target = targetMatches[0];

  const targetAllowlistMatches = allowlistRows.filter(
    (r) => typeof r.email === "string" && r.email.trim().toLowerCase() === targetEmail
  );
  if (targetAllowlistMatches.length > 1) {
    return { ok: false, error: `Ambiguous target allowlist match for: ${targetEmail}` };
  }
  const targetAllowlist = targetAllowlistMatches[0] || null;

  let targetAllowlistAction = "created";
  if (targetAllowlist) {
    const alreadyOk =
      targetAllowlist.role === "OWNER" &&
      targetAllowlist.active === true &&
      (targetAllowlist.removedAt === null || targetAllowlist.removedAt === undefined);
    targetAllowlistAction = alreadyOk ? "unchanged" : "updated";
  }

  let demote = null;
  let demoteAllowlist = null;
  let demoteAllowlistAction = "none";

  if (demoteEmail) {
    const demoteMatches = users.filter(
      (u) => typeof u.email === "string" && u.email.trim().toLowerCase() === demoteEmail
    );
    if (demoteMatches.length === 0) {
      return { ok: false, error: `Demote user not found: ${demoteEmail}` };
    }
    if (demoteMatches.length > 1) {
      return { ok: false, error: `Ambiguous demote user match for: ${demoteEmail}` };
    }
    demote = demoteMatches[0];
    if (demote.id === target.id) {
      return {
        ok: false,
        error: "Target and demote user resolved to the same account.",
      };
    }

    const demoteAllowlistMatches = allowlistRows.filter(
      (r) => typeof r.email === "string" && r.email.trim().toLowerCase() === demoteEmail
    );
    if (demoteAllowlistMatches.length > 1) {
      return { ok: false, error: `Ambiguous demote allowlist match for: ${demoteEmail}` };
    }
    demoteAllowlist = demoteAllowlistMatches[0] || null;
    if (demoteAllowlist) {
      demoteAllowlistAction = demoteAllowlist.active ? "deactivated" : "unchanged";
    }
  }

  const promoteNeeded = target.role !== "OWNER";
  const targetAllowlistNeeded = targetAllowlistAction !== "unchanged";
  const demoteNeeded = Boolean(demote);

  if (!promoteNeeded && !targetAllowlistNeeded && !demoteNeeded) {
    return {
      ok: false,
      error: `User ${targetEmail} (${target.id}) is already OWNER with an active OWNER allowlist row and no --demote-email was given.`,
    };
  }

  return {
    ok: true,
    target: {
      id: target.id,
      email: targetEmail,
      previousRole: target.role,
      newRole: "OWNER",
      promoteNeeded,
      allowlistId: targetAllowlist?.id || null,
      allowlistAction: targetAllowlistAction,
    },
    demote: demote
      ? {
          id: demote.id,
          email: demoteEmail,
          previousRole: demote.role,
          newRole: LOWEST_ROLE,
          revokeSessions: true,
          allowlistId: demoteAllowlist?.id || null,
          allowlistAction: demoteAllowlistAction,
        }
      : null,
  };
}

/**
 * @param {{
 *   prisma: any;
 *   email: string;
 *   demoteEmail?: string;
 *   apply?: boolean;
 *   confirm?: (email: string) => Promise<string>;
 * }} opts
 */
export async function runBreakGlass({
  prisma,
  email,
  demoteEmail,
  apply = false,
  confirm,
}) {
  const normEmail = validateEmail(email);
  const normDemote = demoteEmail ? validateEmail(demoteEmail) : undefined;

  if (normDemote && normDemote === normEmail) {
    return {
      ok: false,
      exitCode: 1,
      message: "--demote-email must differ from --email.",
    };
  }

  const lookupEmails = normDemote ? [normEmail, normDemote] : [normEmail];
  const emailFilter = {
    OR: lookupEmails.map((addr) => ({
      email: { equals: addr, mode: "insensitive" },
    })),
  };

  const [users, allowlistRows] = await Promise.all([
    prisma.user.findMany({
      where: emailFilter,
      select: { id: true, email: true, role: true },
    }),
    prisma.staffAllowlist.findMany({
      where: emailFilter,
      select: { id: true, email: true, role: true, active: true, removedAt: true },
    }),
  ]);

  const plan = planBreakGlass(
    users,
    { email: normEmail, demoteEmail: normDemote },
    allowlistRows
  );
  if (!plan.ok) {
    return {
      ok: false,
      exitCode: 1,
      message: plan.error,
      plan,
    };
  }

  if (!apply) {
    return {
      ok: true,
      dryRun: true,
      exitCode: 0,
      plan,
      sessionsRevoked: 0,
    };
  }

  if (typeof confirm !== "function") {
    return {
      ok: false,
      exitCode: 1,
      message: "Interactive confirmation is required for --apply.",
      plan,
    };
  }

  const typed = await confirm(normEmail);
  if (typeof typed !== "string" || typed.trim().toLowerCase() !== normEmail) {
    return {
      ok: false,
      exitCode: 1,
      message: "Confirmation email did not match. Aborted with no changes.",
      plan,
    };
  }

  let sessionsRevoked = 0;

  await prisma.$transaction(async (tx) => {
    if (plan.target.promoteNeeded) {
      await tx.user.update({
        where: { id: plan.target.id },
        data: { role: "OWNER" },
      });
    }

    if (plan.target.allowlistAction === "created") {
      await tx.staffAllowlist.create({
        data: {
          email: plan.target.email,
          role: "OWNER",
          active: true,
          addedById: plan.target.id,
        },
      });
    } else if (plan.target.allowlistAction === "updated" && plan.target.allowlistId) {
      await tx.staffAllowlist.update({
        where: { id: plan.target.allowlistId },
        data: {
          role: "OWNER",
          active: true,
          removedAt: null,
          addedById: plan.target.id,
        },
      });
    }

    if (plan.target.promoteNeeded || plan.target.allowlistAction !== "unchanged") {
      await tx.auditLog.create({
        data: {
          actorId: plan.target.id,
          action: "break_glass.owner_promote",
          entity: "User",
          entityId: plan.target.id,
          meta: {
            via: "cli",
            previousRole: plan.target.previousRole,
            allowlist: plan.target.allowlistAction,
          },
        },
      });
    }

    if (plan.demote) {
      await tx.user.update({
        where: { id: plan.demote.id },
        data: { role: LOWEST_ROLE },
      });

      const deletedSessions = await tx.session.deleteMany({
        where: { userId: plan.demote.id },
      });
      sessionsRevoked = deletedSessions.count;

      if (plan.demote.allowlistAction === "deactivated" && plan.demote.allowlistId) {
        await tx.staffAllowlist.update({
          where: { id: plan.demote.allowlistId },
          data: {
            active: false,
            removedAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: plan.target.id,
          action: "break_glass.owner_demote",
          entity: "User",
          entityId: plan.demote.id,
          meta: {
            via: "cli",
            previousRole: plan.demote.previousRole,
            allowlist: plan.demote.allowlistAction,
          },
        },
      });
    }
  });

  return {
    ok: true,
    dryRun: false,
    exitCode: 0,
    plan,
    sessionsRevoked,
  };
}

function getSafeDbHost(dbUrl) {
  try {
    return new URL(dbUrl).hostname || "(unknown-host)";
  } catch {
    return "(unparseable-host)";
  }
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[break-glass] ${err instanceof Error ? err.message : "Invalid arguments"}`);
    process.exit(1);
  }

  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[break-glass] Neither DIRECT_URL nor DATABASE_URL is set.");
    process.exit(1);
  }

  const dbHost = getSafeDbHost(dbUrl);
  const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });

  try {
    const result = await runBreakGlass({
      prisma,
      email: args.email,
      demoteEmail: args.demoteEmail,
      apply: args.apply,
      confirm: async (targetEmail) => {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          console.error("[break-glass] --apply requires an interactive TTY terminal.");
          return "";
        }
        return promptLine(`Type target email (${targetEmail}) to confirm --apply: `);
      },
    });

    if (!result.ok) {
      console.error(`[break-glass] Refused: ${result.message}`);
      process.exitCode = 1;
      return;
    }

    const { plan } = result;
    console.log(`[break-glass] Target DB host: ${dbHost}`);
    console.log(
      `[break-glass] Target user: ${plan.target.id} (${plan.target.email}) | role: ${plan.target.previousRole} -> ${plan.target.newRole} | allowlist: ${plan.target.allowlistAction}`
    );
    if (plan.demote) {
      console.log(
        `[break-glass] Demote user: ${plan.demote.id} (${plan.demote.email}) | role: ${plan.demote.previousRole} -> ${plan.demote.newRole} | allowlist: ${plan.demote.allowlistAction} | revoke all sessions`
      );
    }

    if (result.dryRun) {
      console.log("[break-glass] DRY RUN ONLY. No changes written. Re-run with --apply to execute.");
    } else {
      console.log(
        `[break-glass] APPLIED. Sessions revoked for demoted user: ${result.sessionsRevoked}.`
      );
    }
    process.exitCode = 0;
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(`[break-glass] Fatal error: ${err instanceof Error ? err.name : "Error"}`);
    process.exit(1);
  });
}
