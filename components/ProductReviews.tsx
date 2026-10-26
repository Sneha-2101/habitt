"use client";

import { useState, useTransition } from "react";
import StarRating from "./StarRating";
import { submitReview } from "@/lib/actions/reviews";

interface ReviewItem {
  id: string;
  rating: number;
  comment: string;
  createdAt: Date;
  user: {
    name: string;
  };
}

interface ProductReviewsProps {
  productId: string;
  reviews: ReviewItem[];
  isLoggedIn: boolean;
  hasPurchased: boolean;
  hasReviewed: boolean;
}

export default function ProductReviews({
  productId,
  reviews,
  isLoggedIn,
  hasPurchased,
  hasReviewed,
}: ProductReviewsProps) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const averageRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      try {
        await submitReview(productId, rating, comment);
        setSuccessMsg("Thank you! Your review has been submitted.");
        setComment("");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to submit review");
      }
    });
  }

  return (
    <section className="mt-16 pt-10 border-t border-stone">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="font-display text-xl text-ink">Customer Reviews</h2>
          <div className="flex items-center gap-2 mt-1">
            <StarRating rating={averageRating} size="md" showNumeric />
            <span className="text-xs text-stone-dark">
              ({reviews.length} {reviews.length === 1 ? "review" : "reviews"})
            </span>
          </div>
        </div>
      </div>

      {/* Review Submission Form */}
      <div className="mb-10 p-6 border border-stone bg-white rounded-sm max-w-xl">
        <h3 className="text-sm font-semibold text-ink mb-3">Write a Review</h3>
        {!isLoggedIn ? (
          <p className="text-xs text-stone-dark">
            Please <a href={`/login?redirect=/product/${productId}`} className="underline text-ink">sign in</a> to leave a review.
          </p>
        ) : hasReviewed ? (
          <p className="text-xs text-moss font-medium">
            ✓ You have already submitted a review for this product.
          </p>
        ) : !hasPurchased ? (
          <p className="text-xs text-stone-dark">
            Note: Reviews are only available to verified purchasers of this item.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-dark mb-1">Rating</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`text-lg transition-transform ${star <= rating ? "text-amber-500 scale-110" : "text-stone"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-dark mb-1">Your Review</label>
              <textarea
                rows={3}
                required
                placeholder="Share details about fit, quality, material, etc."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-stone bg-white text-[13px] focus:outline-none focus:border-ink rounded-sm"
              />
            </div>

            {errorMsg && <p className="text-xs text-clay font-medium">{errorMsg}</p>}
            {successMsg && <p className="text-xs text-moss font-medium">{successMsg}</p>}

            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2 bg-ink text-paper text-xs font-medium tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isPending ? "SUBMITTING..." : "SUBMIT REVIEW"}
            </button>
          </form>
        )}
      </div>

      {/* Review List */}
      <div className="space-y-4 max-w-2xl">
        {reviews.map((r) => (
          <div key={r.id} className="p-4 border border-stone/60 bg-white rounded-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[13px] text-ink">{r.user.name}</span>
                <span className="text-[11px] text-moss font-medium">
                  ✓ Verified Purchase
                </span>
              </div>
              <span className="text-[11px] text-stone-dark">
                {new Date(r.createdAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <StarRating rating={r.rating} size="sm" />
            <p className="mt-2 text-[13px] text-ink leading-relaxed">{r.comment}</p>
          </div>
        ))}
        {reviews.length === 0 && (
          <p className="text-xs text-stone-dark italic">No reviews yet for this product.</p>
        )}
      </div>
    </section>
  );
}
