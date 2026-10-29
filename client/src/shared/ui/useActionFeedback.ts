import { App } from 'antd';
import { useMemo } from 'react';

/** Action feedback survives feature dialogs closing; field errors stay beside their inputs. */
export function useActionFeedback() {
  const { message } = App.useApp();
  return useMemo(() => ({
    success: (content: string) => { void message.success({ content, duration: 3 }); },
    warning: (content: string) => { void message.warning({ content, duration: 4 }); },
    error: (reason: unknown, fallback = '操作失败，请重试') => {
      const content = reason instanceof Error ? reason.message : typeof reason === 'string' && reason ? reason : fallback;
      void message.error({ content, duration: 5 });
    }
  }), [message]);
}
