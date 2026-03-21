"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Leaf, Loader2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, orgName }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      router.push("/login?registered=true");
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green/10">
            <Leaf className="h-7 w-7 text-green" />
          </div>
          <h1 className="text-2xl font-semibold text-text">Create Account</h1>
          <p className="text-sm text-text-mid">Set up your farm organization</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red/20 bg-red/10 px-4 py-3 text-sm text-red">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="orgName" className="mb-1.5 block text-sm font-medium text-text-mid">
              Organization Name
            </label>
            <input
              id="orgName"
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-card px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none focus:ring-1 focus:ring-green"
              placeholder="Mushu Mushrooms"
            />
          </div>

          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-text-mid">
              Your Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-card px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none focus:ring-1 focus:ring-green"
              placeholder="Anna Svensson"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-text-mid">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-card px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none focus:ring-1 focus:ring-green"
              placeholder="anna@mushufarm.se"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text-mid">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-card px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none focus:ring-1 focus:ring-green"
              placeholder="Min. 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-green px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-green-bright disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Account
          </button>
        </form>

        <p className="text-center text-sm text-text-mid">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-green hover:text-green-bright">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
