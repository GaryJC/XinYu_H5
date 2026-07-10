import { useEffect, useState } from "react";
import { SignaturePage } from "../features/signature/SignaturePage";
import { WorkbenchPage } from "../features/workbench/WorkbenchPage";

export function App() {
  const [signToken, setSignToken] = useState(getSignTokenFromHash());

  useEffect(() => {
    const onHashChange = () => setSignToken(getSignTokenFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (signToken) {
    return (
      <SignaturePage
        token={signToken}
        onBack={() => {
          window.location.hash = "";
          setSignToken(null);
        }}
      />
    );
  }

  return <WorkbenchPage />;
}

function getSignTokenFromHash() {
  const match = window.location.hash.match(/^#\/sign\/(.+)$/);
  return match?.[1] ?? null;
}
