import { lazy,Suspense } from "react";
import { usePageZoomLock } from "../shared/ui/usePageZoomLock";
import { WorkbenchPage } from "../features/workbench/WorkbenchPage";

const SupplierPortalPage=lazy(()=>import("../features/procurement/SupplierPortalPage").then(m=>({default:m.SupplierPortalPage})));

export function App() {
  usePageZoomLock();
  return location.pathname === "/supplier"
    ? <Suspense fallback={<div role="status">正在加载供应商页面…</div>}><SupplierPortalPage /></Suspense>
    : <WorkbenchPage />;
}
