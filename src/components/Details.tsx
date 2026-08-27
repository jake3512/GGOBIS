import type { ReactNode } from "react";

/** Collapses explanatory text and detail metrics behind a native
 * `<details>`/`<summary>` toggle, closed by default — the essential
 * at-a-glance info (name, win rate, top badges) around it stays outside and
 * always visible. Native `<details>` needs no React state per instance and
 * works well on mobile (no extra JS handler, no layout-shift surprises),
 * which is why this app leans on it instead of a custom expand/collapse
 * component. `label` is what shows when collapsed ("세부정보 보기" by
 * default) — CSS flips it to "숨기기" via the `[open]` attribute selector,
 * see globals.css's `.details-toggle`. */
export function Details({ children, label = "세부정보" }: { children: ReactNode; label?: string }) {
  return (
    <details className="details-toggle">
      <summary>
        <span className="details-toggle-label-closed">{label} 보기</span>
        <span className="details-toggle-label-open">{label} 숨기기</span>
      </summary>
      <div className="details-toggle-content">{children}</div>
    </details>
  );
}
