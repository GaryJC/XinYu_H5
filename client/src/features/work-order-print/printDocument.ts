const PX_PER_MM = 96 / 25.4;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 296;
const PAGE_MARGIN = 10;

export function singlePageScale(contentHeight: number) {
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) throw new Error("无法计算委托单打印高度，请重试。");
  return Math.min(1, ((PAGE_HEIGHT - PAGE_MARGIN * 2) * PX_PER_MM) / contentHeight);
}

export function fitSinglePage(paper: HTMLElement, page: HTMLElement) {
  paper.style.transform = "none";
  paper.style.position = "static";
  const scale = singlePageScale(Math.max(paper.scrollHeight, paper.getBoundingClientRect().height));
  paper.style.transform = `scale(${scale})`;
  paper.style.transformOrigin = "top left";
  paper.style.position = "absolute";
  paper.style.top = `${PAGE_MARGIN}mm`;
  paper.style.left = `${(PAGE_WIDTH - 190 * scale) / 2}mm`;
  page.style.height = `${PAGE_HEIGHT}mm`;
}

export async function preparePrintDocument(element: HTMLElement, styles: string, title: string) {
  const frame = document.createElement("iframe");
  frame.title = "委托单打印";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", width: "794px", height: "1123px", left: "-10000px", top: "0", border: "0" });
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    if (!doc || !view) throw new Error("无法创建委托单打印页面，请重试。");
    const style = doc.createElement("style");
    style.textContent = styles;
    doc.head.append(style);
    doc.title = title;
    const viewport = doc.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width, initial-scale=1";
    doc.head.append(viewport);
    doc.documentElement.lang = "zh-CN";
    const page = doc.createElement("main");
    page.className = "wop-print-page";
    const paper = element.cloneNode(true) as HTMLElement;
    page.append(paper);
    doc.body.append(page);
    if (typeof doc.fonts.load === "function") {
      const text = paper.textContent || "机动车修理委托书";
      const boldText = Array.from(paper.querySelectorAll("h1,strong,b,footer")).map(node => node.textContent || "").join("");
      await Promise.all([
        doc.fonts.load('400 12px "Noto Serif SC"', text),
        doc.fonts.load('700 12px "Noto Serif SC"', boldText)
      ]);
    }
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images).map(image => image.decode()));
    // Force layout without waiting on animation frames, which WebViews can
    // suspend for an off-screen iframe.
    doc.body.getBoundingClientRect();
    fitSinglePage(paper, page);
    return { frame, doc, view, page };
  } catch (error) {
    frame.remove();
    throw error;
  }
}


export async function printDocument(element: HTMLElement, styles: string, title: string) {
  const { frame, view } = await preparePrintDocument(element, styles, title);
  try {
    if (typeof view.print !== "function") throw new Error("当前浏览器不支持系统打印，请选择导出 PDF。");
    view.addEventListener("afterprint", () => frame.remove(), { once: true });
    view.focus();
    view.print();
    window.setTimeout(() => frame.remove(), 300_000);
  } catch (error) {
    frame.remove();
    throw error;
  }
}
