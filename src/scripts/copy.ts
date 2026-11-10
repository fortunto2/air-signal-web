// Copy buttons for the whole site, from the shared module superduper-tools/shell (cascade, styles,
// `copy` analytics event). Two hand-written buttons (the pitch strip, the embed snippet) are
// wired here; every other code block on /embed gets a button of its own.
import { initCopyButtons, wireCopyButton } from "superduper-tools/shell";

function wire(button: HTMLButtonElement, source: () => Element | null | undefined, placement: string) {
  button.classList.add("copy-44");
  wireCopyButton(button, () => source()?.textContent ?? "", { label: "Copy", select: source(), kind: "code", placement });
}

document.querySelectorAll<HTMLButtonElement>("[data-pitch-copy]").forEach((b) =>
  wire(b, () => document.getElementById("pitch-code"), "pitch"),
);
document.querySelectorAll<HTMLButtonElement>(".embed [data-copy]").forEach((b) =>
  wire(b, () => b.closest(".embed-body")?.querySelector("code"), "embed"),
);

initCopyButtons({
  selector: "pre.embed-code:not(.embed pre)",
  css:
    ".sd-codecopy{--sd-copy-fg:var(--ink-2);--sd-copy-bg:var(--surface);--sd-copy-bd:var(--line);--sd-copy-accent:var(--accent);--sd-copy-radius:var(--radius);--sd-copy-font:var(--font-mono)}" +
    ".sd-codecopy>.sd-copy-btn{font-size:11px;font-weight:400;letter-spacing:.05em}",
});
