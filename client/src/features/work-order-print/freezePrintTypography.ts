const properties = [
  "font-family", "font-size", "font-style", "font-weight", "font-variant",
  "line-height", "letter-spacing", "word-spacing", "font-synthesis"
] as const;

type TypographySnapshot = Map<string, Record<string, string>>;

/** Read once from the visible preview, before either export iframe can reflow it. */
export function capturePrintTypography(source: HTMLElement): TypographySnapshot {
  const view = source.ownerDocument.defaultView;
  if (!view) throw new Error("无法读取打印页面字号，请重试。");
  const snapshot: TypographySnapshot = new Map();
  for (const node of [source, ...source.querySelectorAll<HTMLElement>("*")]) {
    const key = node.getAttribute("data-wop-capture-key");
    if (key === null) continue;
    const style = view.getComputedStyle(node);
    snapshot.set(key, Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)])));
  }
  return snapshot;
}

/** Both export layouts reuse the preview's metrics, never a reflowed iframe's. */
export async function freezePrintTypography(source: HTMLElement, target: HTMLElement, document: Document,
  snapshot = capturePrintTypography(source)) {
  document.documentElement.classList.add("wop-print-document");
  // html2canvas adds pseudo-element nodes; only copy to keyed original elements.
  for (const clone of [target, ...target.querySelectorAll<HTMLElement>("*")]) {
    const key = clone.getAttribute("data-wop-capture-key");
    const metrics = key === null ? undefined : snapshot.get(key);
    if (!clone.style || !metrics) continue;
    for (const property of properties) clone.style.setProperty(property, metrics[property], "important");
    clone.style.setProperty("-webkit-text-size-adjust", "none", "important");
    clone.style.setProperty("text-size-adjust", "none", "important");
  }
  if (typeof document.fonts.load === "function") {
    await Promise.all([
      document.fonts.load('400 12px "Noto Serif SC"', target.textContent || ""),
      document.fonts.load('700 12px "Noto Serif SC"', Array.from(target.querySelectorAll("h1,strong,b")).map(node => node.textContent || "").join(""))
    ]);
  }
  await document.fonts.ready;
  document.body.getBoundingClientRect();
}

export function markPrintCaptureNodes(page: HTMLElement) {
  [page, ...page.querySelectorAll<HTMLElement>("*")].forEach((node, index) => node.setAttribute("data-wop-capture-key", String(index)));
}
