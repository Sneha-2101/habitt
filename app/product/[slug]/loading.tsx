export default function ProductLoading() {
  return (
    <main className="px-4 sm:px-7 py-10 max-w-5xl mx-auto">
      <div className="grid md:grid-cols-2 gap-8 md:gap-10 items-start">
        <div className="bg-white border border-stone/30 rounded-2xl p-2 overflow-hidden">
          <div className="w-full aspect-[4/5] bg-stone/20 rounded-2xl animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="h-8 bg-stone/20 rounded w-3/4 animate-pulse" />
          <div className="h-6 bg-stone/20 rounded w-1/4 animate-pulse" />
          <div className="h-16 bg-stone/20 rounded w-full animate-pulse" />
          <div className="h-10 bg-stone/20 rounded w-full animate-pulse pt-4" />
          <div className="h-12 bg-stone/20 rounded w-full animate-pulse" />
        </div>
      </div>
    </main>
  );
}
