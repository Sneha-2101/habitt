export interface ExistingSlugRedirect {
  id: string;
  oldSlug: string;
  productId: string;
}

export type SlugChangePlan =
  | { ok: true; createRedirect: boolean; deleteRedirectIds: string[] }
  | { ok: false; reason: string };

/**
 * Pure planner for Product.slug changes:
 * - Same slug -> no-op
 * - If newSlug is an oldSlug of another product -> reject
 * - If newSlug is an oldSlug of this product -> delete that self-redirect row
 * - Creating a redirect for oldSlug is skipped if a row is already present
 */
export function planSlugChange(input: {
  productId: string;
  oldSlug: string;
  newSlug: string;
  existingRedirects: ReadonlyArray<ExistingSlugRedirect>;
}): SlugChangePlan {
  if (input.oldSlug === input.newSlug) {
    return { ok: true, createRedirect: false, deleteRedirectIds: [] };
  }

  const conflicting = input.existingRedirects.find(
    (r) => r.oldSlug === input.newSlug && r.productId !== input.productId
  );
  if (conflicting) {
    return {
      ok: false,
      reason: "Slug is an old link of another product.",
    };
  }

  const deleteRedirectIds = input.existingRedirects
    .filter((r) => r.oldSlug === input.newSlug && r.productId === input.productId)
    .map((r) => r.id);

  const alreadyHasOldRedirect = input.existingRedirects.some(
    (r) => r.oldSlug === input.oldSlug
  );

  return {
    ok: true,
    createRedirect: !alreadyHasOldRedirect,
    deleteRedirectIds,
  };
}
