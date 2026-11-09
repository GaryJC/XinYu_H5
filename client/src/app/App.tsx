import { lazy } from "../shared/ui/recoverableLazy";
import { Suspense } from "react";
import { usePageZoomLock } from "../shared/ui/usePageZoomLock";
import { LoadingState } from "../shared/ui/LoadingState";
import { AppUpdateNotice } from '../shared/app-update/AppUpdateNotice';

const SupplierPortalPage=lazy(()=>import("../features/procurement/SupplierPortalPage").then(m=>({default:m.SupplierPortalPage})));

const CustomerSignaturePage = lazy(() => import("../features/signature/CustomerSignaturePage").then(m => ({ default: m.CustomerSignaturePage })));
const WorkbenchPage = lazy(() => import("../features/workbench/WorkbenchPage").then(m => ({ default: m.WorkbenchPage })));

export function App() {
  usePageZoomLock();
  const page=location.pathname === "/customer-signature" ? <Suspense fallback={<div role="status">正在加载签字页面…</div>}><CustomerSignaturePage /></Suspense> : location.pathname === "/supplier"
    ? <Suspense fallback={<div role="status">正在加载供应商页面…</div>}><SupplierPortalPage /></Suspense>
    : <Suspense fallback={<LoadingState label="正在加载工作台…" />}><WorkbenchPage /></Suspense>;
  return <><AppUpdateNotice/>{page}</>;
}
