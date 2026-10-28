import type { ComponentProps } from "react";
import { isPlaceholder } from "@/lib/site";

/**
 * <a> that flags unresolved "[placeholder]" hrefs with a dashed outline and a
 * tooltip, so they are impossible to miss before launch.
 */
export function SiteLink({ href, title, ...props }: ComponentProps<"a"> & { href: string }) {
  const pending = isPlaceholder(href);
  return (
    <a
      href={href}
      data-placeholder={pending ? "" : undefined}
      title={pending ? `Placeholder: ${href}` : title}
      {...props}
    />
  );
}

/** Visible marker for placeholder text such as [PRICE]. */
export function PlaceholderText({ children }: { children: string }) {
  return isPlaceholder(children) ? (
    <span className="placeholder-text" title="Placeholder">
      {children}
    </span>
  ) : (
    <>{children}</>
  );
}
