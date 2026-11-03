// Keep identifiers as Unicode plain text, including in older DingTalk WebViews.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Older WebViews may expose the API but reject writes. */ }

  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none';
  // Mount inside the active dialog so its focus trap cannot steal the selection.
  const container = focused?.closest('[role="dialog"]') ?? document.body;
  container.appendChild(input);
  const writePlainText = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.clearData();
    event.clipboardData.setData('text/plain', text);
  };
  input.addEventListener('copy', writePlainText);
  try {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.removeEventListener('copy', writePlainText);
    input.remove();
    focused?.focus({ preventScroll: true });
  }
}
