import { usePageZoomLock } from "../shared/ui/usePageZoomLock";
import { WorkbenchPage } from "../features/workbench/WorkbenchPage";

export function App() {
  usePageZoomLock();
  return <WorkbenchPage />;
}
