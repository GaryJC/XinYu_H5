import type { PropsWithChildren } from "react";
import {
  autoPrefixTransformer,
  legacyLogicalPropertiesTransformer,
  StyleProvider,
} from "@ant-design/cssinjs";

// Detect capabilities rather than a phone brand: DingTalk can use a different
// WebView version from the device's standalone browser.
const supports = (feature: string) =>
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports(feature);

export function WebViewStyleProvider({ children }: PropsWithChildren) {
  const supportsWhere = supports("selector(:where(*))");
  const supportsLogical = supports("inset-inline-start: 0px") && supports("margin-block: 0px");

  return (
    <StyleProvider
      hashPriority={supportsWhere ? "low" : "high"}
      transformers={supportsLogical ? [] : [legacyLogicalPropertiesTransformer, autoPrefixTransformer]}
    >
      {children}
    </StyleProvider>
  );
}
