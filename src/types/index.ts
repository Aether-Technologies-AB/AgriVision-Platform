import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface User {
    role?: UserRole;
    organizationId?: string;
    organizationName?: string;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: UserRole;
      organizationId: string;
      organizationName: string;
    };
  }
}

// Augment the JWT type from the same module
declare module "next-auth" {
  interface JWT {
    role?: UserRole;
    organizationId?: string;
    organizationName?: string;
  }
}
