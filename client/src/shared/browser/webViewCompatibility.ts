// CSS.supports('gap', ...) also returns true on browsers that only support
// grid gaps. Measure a flex layout instead (Android WebView before Chrome 84).
export function installWebViewCompatibility() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;display:flex;flex-direction:column;row-gap:1px;visibility:hidden';
  for (let i = 0; i < 2; i++) {
    const child = document.createElement('div');
    child.style.cssText = 'height:0;min-height:0;padding:0;margin:0';
    probe.appendChild(child);
  }
  document.body.appendChild(probe);
  document.documentElement.classList.toggle('legacy-flex-gap', probe.scrollHeight !== 1);
  probe.remove();
}
