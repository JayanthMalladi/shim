"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  type ComponentProps,
} from "react";

/**
 * Minimal disclosure primitive in the shape of shadcn/Radix `Collapsible`:
 * a real <button aria-expanded aria-controls> and a region that is `hidden`
 * when closed. No dependencies.
 */
type CollapsibleContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
};

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

export function useCollapsible(): CollapsibleContextValue {
  const ctx = useContext(CollapsibleContext);
  if (!ctx) throw new Error("Collapsible parts must be used inside <Collapsible>");
  return ctx;
}

export type CollapsibleProps = ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Collapsible({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: CollapsibleProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const contentId = useId();
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  return (
    <CollapsibleContext.Provider value={{ open, setOpen, contentId }}>
      <div data-state={open ? "open" : "closed"} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

export type CollapsibleTriggerProps = Omit<ComponentProps<"button">, "type">;

export function CollapsibleTrigger({ onClick, ...props }: CollapsibleTriggerProps) {
  const { open, setOpen, contentId } = useCollapsible();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={contentId}
      data-state={open ? "open" : "closed"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
      {...props}
    />
  );
}

export type CollapsibleContentProps = ComponentProps<"div">;

export function CollapsibleContent(props: CollapsibleContentProps) {
  const { open, contentId } = useCollapsible();
  return (
    <div
      id={contentId}
      hidden={!open}
      data-state={open ? "open" : "closed"}
      {...props}
    />
  );
}
