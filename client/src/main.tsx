import React from "react";
import ReactDOM from "react-dom/client";
import { BusinessThemeProvider } from "./shared/ui/BusinessForm";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { App } from "./App";
import { WebViewStyleProvider } from "./shared/ui/WebViewStyleProvider";
import "antd/dist/reset.css";
import "./styles.css";

dayjs.locale("zh-cn");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WebViewStyleProvider>
      <BusinessThemeProvider>
        <App />
      </BusinessThemeProvider>
    </WebViewStyleProvider>
  </React.StrictMode>
);
