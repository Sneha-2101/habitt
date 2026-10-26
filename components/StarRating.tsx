interface StarRatingProps {
  rating: number;
  maxStars?: number;
  size?: "sm" | "md" | "lg";
  showNumeric?: boolean;
}

export default function StarRating({
  rating,
  maxStars = 5,
  size = "md",
  showNumeric = false,
}: StarRatingProps) {
  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  }[size];

  return (
    <div className={`inline-flex items-center gap-1 text-amber-500 ${sizeClasses}`}>
      {Array.from({ length: maxStars }).map((_, i) => {
        const starNumber = i + 1;
        const isFilled = rating >= starNumber;
        const isHalf = !isFilled && rating >= starNumber - 0.5;

        return (
          <span key={i} className="select-none">
            {isFilled ? "★" : isHalf ? "½" : "☆"}
          </span>
        );
      })}
      {showNumeric && rating > 0 && (
        <span className="text-stone-dark ml-1 font-mono text-xs">{rating.toFixed(1)}</span>
      )}
    </div>
  );
}
