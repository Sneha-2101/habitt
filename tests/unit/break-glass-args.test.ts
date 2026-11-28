import { describe, it, expect } from "vitest";
import {
  parseArgs,
  validateEmail,
  planBreakGlass,
} from "../../scripts/break-glass-owner.mjs";

describe("scripts/break-glass-owner.mjs helpers", () => {
  it("validates and normalises email addresses", () => {
    expect(validateEmail("  Owner@Example.COM ")).toBe("owner@example.com");
    expect(() => validateEmail("")).toThrow();
    expect(() => validateEmail("not-an-email")).toThrow();
  });

  it("parses valid CLI arguments", () => {
    expect(parseArgs(["--email", "Admin@Example.com"])).toEqual({
      email: "admin@example.com",
      demoteEmail: undefined,
      apply: false,
    });

    expect(
      parseArgs([
        "--email=new@example.com",
        "--demote-email",
        "old@example.com",
        "--apply",
      ])
    ).toEqual({
      email: "new@example.com",
      demoteEmail: "old@example.com",
      apply: true,
    });
  });

  it("rejects missing --email, unknown flags, and identical emails", () => {
    expect(() => parseArgs([])).toThrow(/Missing required --email/);
    expect(() => parseArgs(["--email", "a@b.com", "--bogus"])).toThrow(/Unknown argument/);
    expect(() =>
      parseArgs(["--email", "a@b.com", "--demote-email", "A@B.COM"])
    ).toThrow(/must differ/);
  });

  it("plans promote-only, promote+demote, not-found, same-email, and allowlist states", () => {
    const users = [
      { id: "u1", email: "cust@example.com", role: "CUSTOMER" },
      { id: "u2", email: "owner@example.com", role: "OWNER" },
      { id: "u3", email: "staff@example.com", role: "STAFF" },
    ];
    const allowlist = [
      { id: "a2", email: "owner@example.com", role: "OWNER", active: true, removedAt: null },
      { id: "a3", email: "staff@example.com", role: "STAFF", active: true, removedAt: null },
    ];

    const promoteOnly = planBreakGlass(users, { email: "cust@example.com" }, []);
    expect(promoteOnly).toEqual({
      ok: true,
      target: {
        id: "u1",
        email: "cust@example.com",
        previousRole: "CUSTOMER",
        newRole: "OWNER",
        promoteNeeded: true,
        allowlistId: null,
        allowlistAction: "created",
      },
      demote: null,
    });

    // Target already OWNER with missing allowlist row -> ok (allowlist fix only)
    const ownerMissingAllowlist = planBreakGlass(users, { email: "owner@example.com" }, []);
    expect(ownerMissingAllowlist).toEqual({
      ok: true,
      target: {
        id: "u2",
        email: "owner@example.com",
        previousRole: "OWNER",
        newRole: "OWNER",
        promoteNeeded: false,
        allowlistId: null,
        allowlistAction: "created",
      },
      demote: null,
    });

    // Target with STAFF allowlist row -> updated to OWNER
    const staffAllowlistUpdate = planBreakGlass(
      users,
      { email: "staff@example.com" },
      allowlist
    );
    expect(staffAllowlistUpdate).toEqual({
      ok: true,
      target: {
        id: "u3",
        email: "staff@example.com",
        previousRole: "STAFF",
        newRole: "OWNER",
        promoteNeeded: true,
        allowlistId: "a3",
        allowlistAction: "updated",
      },
      demote: null,
    });

    // Target OWNER with active OWNER row and no demote -> refused
    expect(
      planBreakGlass(users, { email: "owner@example.com" }, allowlist).ok
    ).toBe(false);

    // Demote with existing active row -> deactivated
    const withDemoteRow = planBreakGlass(
      users,
      { email: "cust@example.com", demoteEmail: "owner@example.com" },
      allowlist
    );
    expect(withDemoteRow).toEqual({
      ok: true,
      target: {
        id: "u1",
        email: "cust@example.com",
        previousRole: "CUSTOMER",
        newRole: "OWNER",
        promoteNeeded: true,
        allowlistId: null,
        allowlistAction: "created",
      },
      demote: {
        id: "u2",
        email: "owner@example.com",
        previousRole: "OWNER",
        newRole: "CUSTOMER",
        revokeSessions: true,
        allowlistId: "a2",
        allowlistAction: "deactivated",
      },
    });

    // Demote with no allowlist row -> none
    const withDemoteNoRow = planBreakGlass(
      users,
      { email: "cust@example.com", demoteEmail: "owner@example.com" },
      []
    );
    expect(withDemoteNoRow.ok).toBe(true);
    if (withDemoteNoRow.ok && withDemoteNoRow.demote) {
      expect(withDemoteNoRow.demote.allowlistAction).toBe("none");
    }

    expect(
      planBreakGlass(users, {
        email: "cust@example.com",
        demoteEmail: "cust@example.com",
      }).ok
    ).toBe(false);

    expect(planBreakGlass(users, { email: "missing@example.com" }).ok).toBe(false);
  });
});
