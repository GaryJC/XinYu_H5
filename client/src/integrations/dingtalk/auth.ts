export function getDingTalkAuthCode() {
  const corpId = import.meta.env.VITE_DINGTALK_CORP_ID;
  const dd = window.dd;
  if (!corpId || !dd) return Promise.resolve("");

  return new Promise<string>((resolve, reject) => {
    const request = () => {
      if (dd.runtime?.permission?.requestAuthCode) {
        dd.runtime.permission.requestAuthCode({
          corpId,
          onSuccess: (result) => resolve(result.code || ""),
          onFail: (error) => reject(new Error(formatDingTalkError(error)))
        });
        return;
      }

      if (dd.getAuthCode) {
        dd.getAuthCode({
          corpId,
          success: (result) => resolve(result.authCode || result.code || ""),
          fail: (error) => reject(new Error(formatDingTalkError(error)))
        });
        return;
      }

      resolve("");
    };

    if (dd.ready) dd.ready(request);
    else request();
    if (dd.error) dd.error((error) => reject(new Error(formatDingTalkError(error))));
  });
}

function formatDingTalkError(error: unknown) {
  if (!error) return "钉钉 JSAPI 调用失败";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "钉钉 JSAPI 调用失败";
  }
}

declare global {
  interface Window {
    dd?: {
      ready?: (callback: () => void) => void;
      error?: (callback: (error: unknown) => void) => void;
      runtime?: {
        permission?: {
          requestAuthCode?: (options: {
            corpId: string;
            onSuccess: (result: { code?: string }) => void;
            onFail: (error: unknown) => void;
          }) => void;
        };
      };
      getAuthCode?: (options: {
        corpId: string;
        success: (result: { authCode?: string; code?: string }) => void;
        fail: (error: unknown) => void;
      }) => void;
    };
  }
}
