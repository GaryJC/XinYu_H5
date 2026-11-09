import React from "react";
import {RecoveryBoundary} from "./shared/ui/recoverableLazy";
import ReactDOM from "react-dom/client";
import { BusinessThemeProvider } from "./shared/ui/BusinessForm";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { App } from "./App";
import { WebViewStyleProvider } from "./shared/ui/WebViewStyleProvider";
import "antd/dist/reset.css";
import "./styles.css";
import "./shared/ui/native-date-input.css";
import "./shared/ui/overlay-safe-area.css";
import "./shared/ui/legacy-webview.css";
import { installWebViewCompatibility } from "./shared/browser/webViewCompatibility";

dayjs.locale("zh-cn");
installWebViewCompatibility();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WebViewStyleProvider>
      <BusinessThemeProvider>
        <RecoveryBoundary><App /></RecoveryBoundary>
      </BusinessThemeProvider>
    </WebViewStyleProvider>
  </React.StrictMode>
);
