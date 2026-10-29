import { auth } from "@/lib/auth";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized: Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden: Insufficient permissions") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface GuardUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string;
  user?: GuardUser;
  [key: string]: unknown;
}

export async function requireUser(): Promise<GuardUser> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  const user = session.user as GuardUser;
  // Ensure session.user compatibility
  if (!user.user) {
    user.user = user;
  }
  return user;
}

export async function requireRole(...roles: string[]): Promise<GuardUser> {
  const user = await requireUser();
  const userRole = user.role;
  if (!userRole || !roles.includes(userRole)) {
    throw new ForbiddenError();
  }
  return user;
}

export async function requireStaff(): Promise<GuardUser> {
  return requireRole("STAFF", "OWNER");
}
