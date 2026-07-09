import type { MetadataRoute } from "next";
import { getPublicUrl } from "@/lib/url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/admin", "/d/", "/print/"],
    },
    sitemap: `${getPublicUrl()}/sitemap.xml`,
  };
}
