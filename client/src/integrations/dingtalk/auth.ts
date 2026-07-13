import requestAuthCode from "dingtalk-jsapi/api/union/requestAuthCode";

export async function getDingTalkAuthCode() {
  const clientId = import.meta.env.VITE_DINGTALK_CLIENT_ID;
  const corpId = new URLSearchParams(window.location.search).get("corpid") || import.meta.env.VITE_DINGTALK_CORP_ID;

  if (!/DingTalk/i.test(navigator.userAgent)) return "";
  if (!clientId) throw new Error("未配置钉钉应用 Client ID");
  if (!corpId) throw new Error("未获取到钉钉企业 CorpId");

  try {
    const result = await requestAuthCode({ clientId, corpId });
    if (!result.code) throw new Error("钉钉未返回免登授权码");
    return result.code;
  } catch (error) {
    throw new Error(`获取钉钉免登授权码失败：${formatDingTalkError(error)}`);
  }
}

function formatDingTalkError(error: unknown) {
  if (!error) return "未知错误";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "钉钉 JSAPI 调用失败";
  }
}
