/**
 * Normalize a CSS color to the `#rrggbb` form Monaco's themes require. Azure DevOps theme variables are
 * bare channel triplets such as `255, 255, 255` (consumed by the host as `rgba(var(--x), 1)`), so that
 * form is handled alongside `#hex` and `rgb()/rgba()`. Alpha is dropped; unconvertible values return null.
 */
export function toHexColor(input: string): string | null {
  const value = input.trim();
  if (!value) {
    return null;
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const expanded = hex[1].length === 3 ? hex[1].replace(/(.)/g, "$1$1") : hex[1];
    return `#${expanded.toLowerCase()}`;
  }

  // Channel triplets: "255, 255, 255", "255 255 255", or inside rgb()/rgba(...) — take the first 3.
  const triplet = /([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(value);
  if (triplet) {
    const channel = (raw: string): number => {
      const n = raw.includes("%") ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
      return Math.max(0, Math.min(255, Math.round(n)));
    };
    const [r, g, b] = [channel(triplet[1]), channel(triplet[2]), channel(triplet[3])];
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }

  // Last resort: let the browser resolve named colors (e.g. "white") to an rgb() string.
  if (typeof document !== "undefined" && typeof CanvasRenderingContext2D !== "undefined") {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.fillStyle = value;
      const resolved = typeof ctx.fillStyle === "string" ? ctx.fillStyle : "";
      if (resolved !== value) {
        return toHexColor(resolved);
      }
    }
  }

  return null;
}

function luminance(color: string): number {
  const hex = toHexColor(color);
  if (!hex) {
    return 1;
  }
  const value = hex.slice(1);
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The editor uses Monaco's built-in `vs` / `vs-dark` themes — the same color scheme as the Azure Repos
 * file editor. We deliberately do not define a custom theme: Monaco token colors are fixed by those
 * themes and cannot be derived from the Azure DevOps palette, so re-tinting them would drift away from
 * the built-in look. The light/dark choice follows the host background.
 */
export function currentThemeName(): string {
  const style = getComputedStyle(document.documentElement);
  // --background-color is the themed surface azure-devops-ui itself uses (see core.css .themed);
  // --palette-neutral-0 is the base palette tone and serves as a fallback.
  const background =
    toHexColor(style.getPropertyValue("--background-color")) ||
    toHexColor(style.getPropertyValue("--palette-neutral-0")) ||
    "#ffffff";
  return luminance(background) < 0.5 ? "vs-dark" : "vs";
}
