"use client";

import { useState, useEffect } from "react";
import { Users, Plus, Trash2, Loader2, Shield, Eye, Wrench } from "lucide-react";

interface UserData {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

const roleIcons: Record<string, React.ReactNode> = {
  OWNER: <Shield className="h-3 w-3" />,
  OPERATOR: <Wrench className="h-3 w-3" />,
  VIEWER: <Eye className="h-3 w-3" />,
};

const roleColors: Record<string, string> = {
  OWNER: "bg-amber/15 text-amber",
  OPERATOR: "bg-blue/15 text-blue",
  VIEWER: "bg-text-dim/20 text-text-dim",
};

export default function UserManager({ currentUserId, currentUserRole }: { currentUserId: string; currentUserRole: string }) {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formRole, setFormRole] = useState("OPERATOR");
  const [formPassword, setFormPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const isOwner = currentUserRole === "OWNER";

  useEffect(() => { fetchUsers(); }, []);

  function fetchUsers() {
    setLoading(true);
    fetch("/api/settings/users")
      .then((r) => r.json())
      .then((d) => { setUsers(d.users || []); setLoading(false); });
  }

  async function createUser() {
    setCreating(true);
    setError("");
    const res = await fetch("/api/settings/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formName, email: formEmail, role: formRole, password: formPassword }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) {
      setError(data.error || "Failed to create user");
      return;
    }
    setShowForm(false);
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    fetchUsers();
  }

  async function updateRole(id: string, role: string) {
    await fetch(`/api/settings/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    fetchUsers();
  }

  async function removeUser(id: string) {
    await fetch(`/api/settings/users/${id}`, { method: "DELETE" });
    fetchUsers();
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Team Members</h3>
        {isOwner && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 rounded-lg bg-green/15 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/25"
          >
            <Plus className="h-3 w-3" /> Invite User
          </button>
        )}
      </div>

      {/* Invite form */}
      {showForm && (
        <div className="mb-4 rounded-lg border border-green/20 bg-green/5 p-3 space-y-2">
          {error && (
            <div className="rounded-lg border border-red/20 bg-red/10 px-3 py-1.5 text-xs text-red">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] text-text-dim">Name</label>
              <input
                value={formName} onChange={(e) => setFormName(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-text-dim">Email</label>
              <input
                type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] text-text-dim">Role</label>
              <select
                value={formRole} onChange={(e) => setFormRole(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
              >
                <option value="OPERATOR">Operator</option>
                <option value="VIEWER">Viewer</option>
                <option value="OWNER">Owner</option>
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-text-dim">Temporary Password</label>
              <input
                type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-green focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={createUser}
              disabled={creating || !formName || !formEmail || !formPassword}
              className="flex items-center gap-1 rounded-lg bg-green px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
              Create User
            </button>
            <button onClick={() => { setShowForm(false); setError(""); }} className="text-xs text-text-dim hover:text-text-mid">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users list */}
      {loading ? (
        <p className="text-sm text-text-dim">Loading users...</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-border text-xs font-medium text-text-mid">
                  {(u.name || u.email)[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-text">{u.name || u.email}</p>
                  <p className="text-[10px] text-text-dim">
                    {u.email} &middot; Joined {new Date(u.createdAt).toLocaleDateString("sv-SE")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isOwner && u.id !== currentUserId ? (
                  <select
                    value={u.role}
                    onChange={(e) => updateRole(u.id, e.target.value)}
                    className="rounded-lg border border-border bg-bg px-2 py-1 text-[10px] text-text focus:border-green focus:outline-none"
                  >
                    <option value="OWNER">Owner</option>
                    <option value="OPERATOR">Operator</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                ) : (
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${roleColors[u.role] || ""}`}>
                    {roleIcons[u.role]}
                    {u.role}
                  </span>
                )}
                {isOwner && u.id !== currentUserId && (
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${u.name || u.email}?`)) removeUser(u.id);
                    }}
                    className="rounded p-1.5 text-text-dim hover:bg-red/10 hover:text-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
