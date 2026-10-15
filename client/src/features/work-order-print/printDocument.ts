export async function printDocument(element: HTMLElement, styles: string, title: string) {
  const frame = document.createElement("iframe");
  frame.title = "委托单打印";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", width: "1px", height: "1px", left: "-10000px", top: "0", border: "0" });
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    if (!doc || !view || typeof view.print !== "function") throw new Error("当前浏览器不支持打印，请在电脑浏览器打开委托单打印。");
    const style = doc.createElement("style");
    style.textContent = styles;
    doc.head.append(style);
    doc.title = title;
    doc.documentElement.lang = "zh-CN";
    doc.body.append(element.cloneNode(true));
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images).map(image => image.decode()));
    // Force layout without waiting on animation frames, which WebViews can
    // suspend for an off-screen iframe.
    doc.body.getBoundingClientRect();
    // Leave the frame alive while the browser owns its print preview.
    view.addEventListener("afterprint", () => frame.remove(), { once: true });
    view.focus();
    view.print();
    window.setTimeout(() => frame.remove(), 300_000);
  } catch (error) {
    frame.remove();
    throw error;
  }
}
