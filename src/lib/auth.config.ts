import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [], // Populated in auth.ts with credentials provider
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isPublic =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/register") ||
        nextUrl.pathname.startsWith("/api/auth") ||
        nextUrl.pathname.startsWith("/api/agent");

      if (isPublic) return true;
      if (isLoggedIn) return true;
      return false; // Redirect to login
    },
    async jwt({ token, user }) {
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = user as any;
        token.role = u.role;
        token.organizationId = u.organizationId;
        token.organizationName = u.organizationName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = session.user as any;
        s.id = token.sub!;
        s.role = token.role;
        s.organizationId = token.organizationId;
        s.organizationName = token.organizationName;
      }
      return session;
    },
  },
};
