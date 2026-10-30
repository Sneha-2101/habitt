import { getSessionUser } from "@/lib/sessions";

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

export class StepUpRequiredError extends Error {
  constructor(message = "Step-up authentication required") {
    super(message);
    this.name = "StepUpRequiredError";
  }
}

export interface GuardUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string;
  phone?: string | null;
  sid?: string;
  stepUpAt?: Date | null;
  user?: GuardUser;
  [key: string]: unknown;
}

export async function requireUser(): Promise<GuardUser> {
  const sessionUser = await getSessionUser();
  if (!sessionUser?.id) {
    throw new UnauthorizedError();
  }
  const user: GuardUser = {
    ...sessionUser,
  };
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

export async function requireFreshStepUp(maxAgeMs = 10 * 60 * 1000): Promise<GuardUser> {
  const user = await requireUser();
  if (!user.stepUpAt) {
    throw new StepUpRequiredError();
  }
  const age = Date.now() - new Date(user.stepUpAt).getTime();
  if (age > maxAgeMs) {
    throw new StepUpRequiredError();
  }
  return user;
}
