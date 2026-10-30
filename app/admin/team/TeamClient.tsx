"use client";

import { useState } from "react";
import { Role } from "@prisma/client";
import { addStaff, changeStaffRole, removeStaff } from "@/lib/actions/team";
import { requestStepUpAction, confirmStepUpAction } from "@/lib/actions/step-up";

export interface AllowlistEntry {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string | Date;
  removedAt?: string | Date | null;
}

export default function TeamClient({
  entries,
  currentUserEmail,
}: {
  entries: AllowlistEntry[];
  currentUserEmail: string;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("STAFF");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Step-up state
  const [showStepUp, setShowStepUp] = useState(false);
  const [stepUpCode, setStepUpCode] = useState("");
  const [stepUpLoading, setStepUpLoading] = useState(false);
  const [stepUpMsg, setStepUpMsg] = useState("");
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  async function handleActionWithStepUp(actionFn: () => Promise<void>) {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await actionFn();
      setLoading(false);
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("Step-up") ||
        msg.includes("step-up") ||
        msg.includes("StepUpRequiredError")
      ) {
        setPendingAction(() => actionFn);
        setShowStepUp(true);
        // Automatically request code
        try {
          const res = await requestStepUpAction();
          setStepUpMsg(res.message);
        } catch (reqErr: unknown) {
          setStepUpMsg(reqErr instanceof Error ? reqErr.message : "Failed to send code");
        }
      } else {
        setError(msg);
      }
    }
  }

  async function handleConfirmStepUp(e: React.FormEvent) {
    e.preventDefault();
    setStepUpLoading(true);
    setError("");
    try {
      await confirmStepUpAction(stepUpCode.trim());
      setShowStepUp(false);
      setStepUpCode("");
      setStepUpLoading(false);
      // Run pending action
      if (pendingAction) {
        setLoading(true);
        await pendingAction();
        setPendingAction(null);
        setLoading(false);
        setSuccess("Action completed successfully.");
      }
    } catch (err: unknown) {
      setStepUpLoading(false);
      setError(err instanceof Error ? err.message : "Invalid verification code.");
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;

    await handleActionWithStepUp(async () => {
      await addStaff(newEmail.trim(), newRole);
      setNewEmail("");
      setSuccess(`Added ${newEmail.trim()} as ${newRole}.`);
    });
  }

  async function handleRoleChange(id: string, email: string, targetRole: Role) {
    await handleActionWithStepUp(async () => {
      await changeStaffRole(id, targetRole);
      setSuccess(`Changed role for ${email} to ${targetRole}.`);
    });
  }

  async function handleRemove(id: string, email: string) {
    if (!confirm(`Are you sure you want to remove staff access for ${email}?`)) {
      return;
    }

    await handleActionWithStepUp(async () => {
      await removeStaff(id);
      setSuccess(`Removed staff access for ${email}.`);
    });
  }

  const activeEntries = entries.filter((e) => e.active);
  const removedEntries = entries.filter((e) => !e.active);

  return (
    <div className="space-y-8 max-w-5xl mx-auto py-8 px-4">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Staff & Team Management</h1>
        <p className="text-xs text-stone-dark mt-1">
          Owner access only. Manage administrative permissions and staff allowlist.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-xs">
          {success}
        </div>
      )}

      {/* Step-up Modal */}
      {showStepUp && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-xs max-w-md w-full border border-stone shadow-lg space-y-4">
            <h3 className="font-display text-lg font-semibold text-ink">
              Step-Up Verification Required
            </h3>
            <p className="text-xs text-stone-dark">
              {stepUpMsg || "A verification code has been sent to your email to confirm this sensitive action."}
            </p>

            <form onSubmit={handleConfirmStepUp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  6-Digit Verification Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={stepUpCode}
                  onChange={(e) => setStepUpCode(e.target.value)}
                  placeholder="000000"
                  required
                  autoFocus
                  className="w-full px-3 py-2 border border-stone rounded-xs text-center font-mono tracking-widest text-base focus:outline-none focus:border-ink"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowStepUp(false);
                    setPendingAction(null);
                  }}
                  className="px-3 py-2 text-xs text-stone-dark hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={stepUpLoading || stepUpCode.length !== 6}
                  className="px-4 py-2 bg-ink text-paper text-xs font-semibold rounded-xs disabled:opacity-50"
                >
                  {stepUpLoading ? "Verifying..." : "Confirm & Proceed"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Staff Member Form */}
      <div className="bg-white p-6 border border-stone rounded-xs shadow-xs">
        <h2 className="text-sm font-semibold text-ink mb-3">Add Team Member</h2>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="colleague@habitt.com"
            required
            className="flex-1 px-3 py-2 border border-stone text-xs rounded-xs focus:outline-none focus:border-ink"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
            className="px-3 py-2 border border-stone text-xs rounded-xs focus:outline-none focus:border-ink"
          >
            <option value="STAFF">STAFF</option>
            <option value="OWNER">OWNER</option>
          </select>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 bg-ink text-paper text-xs font-semibold uppercase tracking-wider rounded-xs hover:bg-ink-light disabled:opacity-50"
          >
            {loading ? "Adding..." : "Add Member"}
          </button>
        </form>
      </div>

      {/* Active Team Table */}
      <div className="bg-white border border-stone rounded-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-stone">
          <h2 className="text-sm font-semibold text-ink">Active Personnel ({activeEntries.length})</h2>
        </div>
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-light/50 border-b border-stone text-stone-dark uppercase tracking-wider font-medium">
            <tr>
              <th className="py-3 px-6">Email</th>
              <th className="py-3 px-6">Role</th>
              <th className="py-3 px-6">Added Date</th>
              <th className="py-3 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone">
            {activeEntries.map((member) => {
              const isSelf = member.email === currentUserEmail;
              return (
                <tr key={member.id} className="hover:bg-paper transition-colors">
                  <td className="py-3 px-6 font-medium text-ink">
                    {member.email} {isSelf && <span className="text-[10px] text-stone-dark font-normal">(You)</span>}
                  </td>
                  <td className="py-3 px-6">
                    <span className={`inline-block px-2 py-0.5 rounded-xs text-[11px] font-semibold ${
                      member.role === "OWNER" ? "bg-amber-100 text-amber-900" : "bg-stone-light text-stone-dark"
                    }`}>
                      {member.role}
                    </span>
                  </td>
                  <td className="py-3 px-6 text-stone-dark">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-6 text-right space-x-2">
                    {!isSelf && (
                      <>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => handleRoleChange(member.id, member.email, member.role === "OWNER" ? "STAFF" : "OWNER")}
                          className="text-xs text-stone-dark hover:text-ink underline disabled:opacity-50"
                        >
                          Switch to {member.role === "OWNER" ? "STAFF" : "OWNER"}
                        </button>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => handleRemove(member.id, member.email)}
                          className="text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50 ml-2"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Removed Personnel Table */}
      {removedEntries.length > 0 && (
        <div className="bg-white border border-stone rounded-xs overflow-hidden opacity-75">
          <div className="px-6 py-4 border-b border-stone">
            <h2 className="text-sm font-semibold text-stone-dark">Removed Personnel ({removedEntries.length})</h2>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-light/50 border-b border-stone text-stone-dark uppercase tracking-wider font-medium">
              <tr>
                <th className="py-3 px-6">Email</th>
                <th className="py-3 px-6">Last Role</th>
                <th className="py-3 px-6">Removed Date</th>
                <th className="py-3 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone">
              {removedEntries.map((member) => (
                <tr key={member.id} className="text-stone-dark">
                  <td className="py-3 px-6">{member.email}</td>
                  <td className="py-3 px-6">{member.role}</td>
                  <td className="py-3 px-6">
                    {member.removedAt ? new Date(member.removedAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-3 px-6 text-right">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleRoleChange(member.id, member.email, member.role)}
                      className="text-xs text-ink hover:underline disabled:opacity-50"
                    >
                      Restore Access
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

