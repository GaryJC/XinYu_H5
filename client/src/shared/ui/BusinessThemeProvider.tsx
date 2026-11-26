import type { PropsWithChildren } from "react";
import { App as AntApp, ConfigProvider, Grid } from "antd";
import zhCN from "antd/locale/zh_CN";

export function BusinessThemeProvider({ children }: PropsWithChildren) {
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  return <ConfigProvider locale={zhCN} theme={{
    token: {
      colorPrimary: "#2563eb", colorBgLayout: "#f4f6fa", colorBorder: "#dce2ea",
      colorText: "#243247", colorTextSecondary: "#657085",
      borderRadius: 10, borderRadiusLG: 16,
      controlHeight: mobile ? 44 : 36, controlHeightLG: 44,
      fontSize: mobile ? 16 : 14,
    },
    components: {
      Message: { zIndexPopup: 4000 },
      Card: { borderRadiusLG: 16 },
      Form: { itemMarginBottom: 16, verticalLabelPadding: "0 0 8px" },
    },
  }}><AntApp message={{ maxCount: 3, top: mobile ? 20 : 32 }}>{children}</AntApp></ConfigProvider>;
}
