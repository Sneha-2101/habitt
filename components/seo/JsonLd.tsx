import { serializeJsonLd } from "@/lib/seo/jsonld";

export default function JsonLd({ data }: { data: unknown }) {
  // Safe: serializeJsonLd escapes <, >, &, U+2028, and U+2029 so JSON-LD cannot break out of <script>.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
