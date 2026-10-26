export default function ShopLoading() {
  return (
    <main className="px-4 sm:px-7 py-10">
      <div className="flex gap-2 flex-wrap mb-8">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="w-20 h-8 bg-stone/20 rounded-full animate-pulse" />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="bg-white rounded-2xl p-2 border border-stone/30 space-y-3">
            <div className="w-full aspect-[4/5] bg-stone/20 rounded-2xl animate-pulse" />
            <div className="p-2 space-y-2">
              <div className="h-4 bg-stone/20 rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-stone/20 rounded w-1/2 animate-pulse" />
              <div className="h-4 bg-stone/20 rounded w-1/4 animate-pulse pt-2" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
