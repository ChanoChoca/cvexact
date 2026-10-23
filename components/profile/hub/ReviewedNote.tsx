import { Badge } from "@/components/ui";

/**
 * What a fold says on the right of its title, shut or open: «Para revisar» while something inside it is marked.
 * It is in the line of the title and not in the body, so a section that is shut still says that one of its cards wants a look.
 */
export function FoldStatus({ review = false }: { review?: boolean }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 empty:hidden">
      {review ? <Badge tone="warn">Para revisar</Badge> : null}
    </span>
  );
}
