import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Sizes are deliberately roomy — the desktop app's spacing language carried onto
 * the web. The default control is 48px tall with a 15px label, never a cramped
 * 32px pill.
 */
const variants = {
  primary:
    "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary:
    "border border-border bg-surface-raised text-foreground hover:border-border-strong hover:bg-surface-sunken",
  ghost: "text-muted-foreground hover:bg-surface-sunken hover:text-foreground",
  outline:
    "border border-accent/30 bg-accent-tint text-accent hover:border-accent/60 hover:bg-accent-soft",
} as const;

const sizes = {
  sm: "h-10 gap-2 rounded-lg px-4 text-[14px]",
  md: "h-12 gap-2.5 rounded-xl px-6 text-[15px]",
  lg: "h-14 gap-3 rounded-xl px-8 text-[16px]",
  icon: "size-11 rounded-xl",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const buttonClasses = (
  variant: keyof typeof variants = "primary",
  size: keyof typeof sizes = "md",
  className?: string,
) =>
  cn(
    "inline-flex select-none items-center justify-center font-medium",
    "transition-[background-color,border-color,color] duration-200",
    "disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant = "primary", size = "md", ...props }, ref) {
    return (
      <button ref={ref} className={buttonClasses(variant, size, className)} {...props} />
    );
  },
);

export interface LinkButtonProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  function LinkButton({ className, variant = "primary", size = "md", ...props }, ref) {
    return <a ref={ref} className={buttonClasses(variant, size, className)} {...props} />;
  },
);
