import { Component, Suspense, lazy as reactLazy, useMemo, useState, type ComponentType, type ComponentProps, createElement, type ReactNode } from 'react';

class FeatureBoundary extends Component<{ children: ReactNode; retry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" style={{ padding: 16, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
      <p style={{ margin: '0 0 12px' }}>此功能暂时无法加载，请检查网络后重试。</p>
      <button type="button" onClick={this.props.retry}>重新加载</button>
    </div>;
    return this.props.children;
  }
}

// A rejected React.lazy instance caches its error. A deliberate retry creates a
// fresh instance; the parent controller (including the order draft) stays mounted.
export function lazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): ComponentType<ComponentProps<T>> {
  return function RecoverableFeature(props: ComponentProps<T>) {
    const [attempt, setAttempt] = useState(0);
    const Feature = useMemo(() => reactLazy(load), [attempt]);
    return <FeatureBoundary key={attempt} retry={() => setAttempt(value => value + 1)}><Suspense fallback={<div role="status" style={{padding:16}}>正在加载…</div>}>{createElement(Feature, props)}</Suspense></FeatureBoundary>;
  };
}

export function RecoveryBoundary({children}:{children:ReactNode}) {
  const [attempt,setAttempt]=useState(0);
  return <FeatureBoundary key={attempt} retry={()=>setAttempt(value=>value+1)}>{children}</FeatureBoundary>;
}
