// Copy buttons for the whole site. The mechanics (clipboard API, then a hidden textarea +
// execCommand for in-app browsers, then select-and-long-press) live in superduper-tools/shell.
// Two existing buttons are wired here (the pitch strip, the embed snippet) and every other
// code block on /embed gets one.
import { attachCodeCopy, copyButton } from "superduper-tools/shell";

type Sda = (name: string, props?: Record<string, string>) => void;
const count = (placement: string) =>
  (window as unknown as { sda?: Sda }).sda?.("code_copied", { path: location.pathname, placement });

function wire(button: HTMLButtonElement, source: () => Element | null | undefined, placement: string) {
  button.classList.add("copy-44");
  copyButton(
    button,
    () => source()?.textContent ?? "",
    { label: "Copy", select: source() },
    () => count(placement),
  );
}

document.querySelectorAll<HTMLButtonElement>("[data-pitch-copy]").forEach((b) =>
  wire(b, () => document.getElementById("pitch-code"), "pitch"),
);
document.querySelectorAll<HTMLButtonElement>(".embed [data-copy]").forEach((b) =>
  wire(b, () => b.closest(".embed-body")?.querySelector("code"), "embed"),
);

attachCodeCopy({
  selector: "pre.embed-code:not(.embed pre)",
  onCopied: () => count("code"),
  css:
    ".sd-codecopy{--sd-copy-fg:var(--ink-2);--sd-copy-bg:var(--surface);--sd-copy-bd:var(--line);--sd-copy-accent:var(--accent)}" +
    ".sd-codecopy>.sd-copy-btn{font-family:var(--font-mono);font-size:11px;font-weight:400;letter-spacing:.05em;border-radius:var(--radius)}",
});
