// A thin server component so this route can carry its own metadata (title,
// canonical, per-page Open Graph URL). The interactive UI — release lookup, OS
// detection, copy buttons — lives in the client component it renders.
import type { Metadata } from "next";

import DownloadClient from "./download-client";
import { SITE_URL } from "@/lib/site";

const title = "Download";
const description =
  "Download Uxnan Desktop for Windows, macOS or Linux, on the stable or nightly channel — and get Uxnan Mobile plus the bridge for your phone. Free and open source.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/download/" },
  openGraph: {
    title: `${title} · Uxnan`,
    description,
    url: `${SITE_URL}/download/`,
  },
  twitter: { title: `${title} · Uxnan`, description },
};

export default function DownloadPage() {
  return <DownloadClient />;
}
