"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Github, Menu, X } from "lucide-react";

import { RepoStatsLine } from "./repo-stats-line";
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
  { href: "#features", label: "Demo" },
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
          {/*
            The only GitHub affordance the compact bar carries. There used to
            be a live star/download pill here too (`hidden lg:inline-flex`),
            which meant a phone visitor saw neither it nor this icon (`sm:grid`
            hid this one below 640px) — the repo had no presence in the header
            at all on a phone. The counters now live in exactly one place, the
            hero's own stats line (visible at every width) plus the mobile
            menu overlay below; this plain icon-link is visible at every width
            in exchange, so there is always a way to reach the repo from here.
          */}
          <a
            href={links.github}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Uxnan on GitHub"
            className="grid size-11 place-items-center rounded-xl border border-border bg-surface-raised text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
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

      {/*
        A full-screen overlay, not a dropdown. The dropdown used to sit in
        normal flow right under the compact bar — at typical phone heights
        that meant the hamburger button and the hero's own CTAs were still
        visible (and tappable) behind/around it, which read as unfinished.
        This covers the viewport outright, above everything (`z-[60]`, over
        the header's own `z-50`), with its own close control and a scroll-lock
        on `document.body` for as long as it is open (see the effect above).
      */}
      {menuOpen && !minimal && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-background lg:hidden">
          <div className="shell flex h-[72px] shrink-0 items-center">
            <Link
              href="/"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 font-semibold tracking-tight"
            >
              <img src="/logo.svg" alt="" aria-hidden className="size-8 rounded-lg" />
              <span className="text-[17px]">Uxnan</span>
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="ml-auto grid size-11 place-items-center rounded-xl border border-border bg-surface-raised text-muted-foreground"
            >
              <X className="size-[18px]" />
            </button>
          </div>

          <nav className="shell flex flex-1 flex-col justify-center gap-1 overflow-y-auto pb-16">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={resolve(item.href)}
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-3.5 text-[22px] font-medium text-foreground hover:bg-surface-sunken"
              >
                {item.label}
              </a>
            ))}
            <LinkButton href="/download/" size="lg" className="mt-5 w-full">
              Download
            </LinkButton>

            <div className="mt-10 border-t border-border/70 pt-8 text-center">
              <p className="eyebrow justify-center">
                <span className="size-1.5 rounded-full bg-positive" />
                Free · Open source · MPL-2.0
              </p>
              <RepoStatsLine className="mt-4" />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
