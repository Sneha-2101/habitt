/**
 * Helpers for keeping `next build` resilient when the database is unreachable,
 * without ever swallowing runtime errors.
 */

export function isProductionBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export async function readOrBuildFallback<T>(
  read: () => Promise<T>,
  fallback: T,
  label: string
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (isProductionBuild()) {
      console.warn(`${label}: using build fallback`);
      return fallback;
    }
    throw err;
  }
}
