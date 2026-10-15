const properties = [
  "font-family", "font-size", "font-style", "font-weight", "font-variant",
  "line-height", "letter-spacing", "word-spacing", "font-synthesis"
] as const;

/** Freeze resolved text metrics before html2canvas performs its second layout. */
export async function freezePrintTypography(source: HTMLElement, target: HTMLElement, document: Document) {
  const view = source.ownerDocument.defaultView;
  if (!view) throw new Error("无法读取打印页面字号，请重试。");
  document.documentElement.classList.add("wop-print-document");
  const sourceNodes = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const targetNodes = [target, ...target.querySelectorAll<HTMLElement>("*")];
  // html2canvas inserts nodes for CSS pseudo-elements. Match real elements by
  // a temporary key assigned before capture, rather than their child positions.
  const targets = new Map(targetNodes.map(node => [node.getAttribute("data-wop-capture-key"), node]));
  for (const node of sourceNodes) {
    const clone = targets.get(node.getAttribute("data-wop-capture-key"));
    if (!clone?.style) continue;
    const style = view.getComputedStyle(node);
    for (const property of properties) clone.style.setProperty(property, style.getPropertyValue(property), "important");
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
