import { useEffect, useRef, useState } from 'react';
import type { CustomerSignatureSession } from '../../../../shared/types';
import { customerSignatureApi } from './customerSignatureApi';

export function useCustomerSignature() {
  const [token] = useState(() => { try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; } });
  const [session, setSession] = useState<CustomerSignatureSession>();
  const [image, setImage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState(token ? '' : '缺少签字链接，请打开服务顾问发送的完整链接。');
  const [landscape, setLandscape] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    if (!token) return;
    let active = true;
    void customerSignatureApi.session(token).then(data => { if (active) setSession(data); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    if (!landscape) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [landscape]);
  async function submit() {
    if (running.current || !image || !confirmed || session?.state !== 'pending') return;
    running.current = true; setBusy(true); setError('');
    try { setSession(await customerSignatureApi.sign({ token, imageBase64: image, confirmed })); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '签字提交失败，请重试');
      // Recover a successful commit whose response was lost, or another device's signature.
      try { const current = await customerSignatureApi.session(token); if (current.state === 'signed') setSession(current); } catch { /* Keep the original actionable error. */ }
    } finally { running.current = false; setBusy(false); }
  }
  return { session, image, setImage, confirmed, setConfirmed, busy, loading, error, landscape, setLandscape, submit };
}
