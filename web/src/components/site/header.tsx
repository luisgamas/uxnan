"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Github, Menu, X } from "lucide-react";

import { GitHubStats } from "./github-stats";
import { ThemeToggle } from "./theme-toggle";
import { LinkButton } from "@/components/ui/button";
import { useScrolledPast } from "@/lib/hooks";
import { links } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Nav entries. In-page anchors only resolve on the home page, so away from it
 * they are rewritten to `/#id` — otherwise "Why" on the desktop page would jump
 * nowhere.
 */
const NAV = [
  { href: "#problem", label: "Why" },
  { href: "#apps", label: "Apps" },
  { href: "#features", label: "Look" },
  { href: "#faq", label: "FAQ" },
  { href: "/download/", label: "Download" },
];

export function Header({ minimal = false }: { minimal?: boolean }) {
  const scrolled = useScrolledPast(16);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const onHome = pathname === "/" || pathname === "";

  const resolve = (href: string) =>
    href.startsWith("#") && !onHome ? `/${href}` : href;

  useEffect(() => {
    if (!menuOpen) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const close = () => mq.matches && setMenuOpen(false);
    mq.addEventListener("change", close);
    document.body.style.overflow = "hidden";
    return () => {
      mq.removeEventListener("change", close);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  // Close the drawer whenever navigation lands somewhere new.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled || minimal
          ? "border-b border-border/70 bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <div className="shell flex h-[72px] items-center gap-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold tracking-tight"
        >
          <img src="/logo.svg" alt="" aria-hidden className="size-8 rounded-lg" />
          <span className="text-[17px]">Uxnan</span>
        </Link>

        {!minimal && (
          <nav className="ml-6 hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={resolve(item.href)}
                className="rounded-lg px-3.5 py-2 text-[15px] text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2.5">
          <GitHubStats className="hidden xl:inline-flex" />
          <a
            href={links.github}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Uxnan on GitHub"
            className="hidden size-11 place-items-center rounded-xl border border-border bg-surface-raised text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground sm:grid"
          >
            <Github className="size-[18px]" aria-hidden />
          </a>
          <ThemeToggle />
          <LinkButton
            href="/download/"
            size="sm"
            className="hidden h-11 px-5 sm:inline-flex"
          >
            Download
          </LinkButton>
          {!minimal && (
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="grid size-11 place-items-center rounded-xl border border-border bg-surface-raised text-muted-foreground lg:hidden"
            >
              {menuOpen ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
            </button>
          )}
        </div>
      </div>

      {menuOpen && !minimal && (
        <div className="border-t border-border bg-background lg:hidden">
          <nav className="shell flex flex-col py-4">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={resolve(item.href)}
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-3.5 text-[16px] text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
            <LinkButton href="/download/" className="mt-3">
              Download
            </LinkButton>
          </nav>
        </div>
      )}
    </header>
  );
}
