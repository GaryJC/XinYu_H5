import { lazy,Suspense } from "react";
import { usePageZoomLock } from "../shared/ui/usePageZoomLock";
import { WorkbenchPage } from "../features/workbench/WorkbenchPage";
import { AppUpdateNotice } from '../shared/app-update/AppUpdateNotice';

const SupplierPortalPage=lazy(()=>import("../features/procurement/SupplierPortalPage").then(m=>({default:m.SupplierPortalPage})));

const CustomerSignaturePage = lazy(() => import("../features/signature/CustomerSignaturePage").then(m => ({ default: m.CustomerSignaturePage })));

export function App() {
  usePageZoomLock();
  const page=location.pathname === "/customer-signature" ? <Suspense fallback={<div role="status">正在加载签字页面…</div>}><CustomerSignaturePage /></Suspense> : location.pathname === "/supplier"
    ? <Suspense fallback={<div role="status">正在加载供应商页面…</div>}><SupplierPortalPage /></Suspense>
    : <WorkbenchPage />;
  return <><AppUpdateNotice/>{page}</>;
}
