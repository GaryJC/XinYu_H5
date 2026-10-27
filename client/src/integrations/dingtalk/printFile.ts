import "dingtalk-jsapi/platform";
import saveFileToDingTalk from "dingtalk-jsapi/api/union/saveFileToDingTalk";
import previewFileInDingTalk from "dingtalk-jsapi/api/union/previewFileInDingTalk";

export function isDingTalkMobile() {
  return /DingTalk/i.test(navigator.userAgent) && /Android|iPhone|iPad|iPod|HarmonyOS/i.test(navigator.userAgent);
}

export async function savePrintFile(url: string, name: string) {
  const corpId = new URLSearchParams(window.location.search).get("corpid") || import.meta.env.VITE_DINGTALK_CORP_ID;
  if (!corpId) throw new Error("未获取到钉钉企业 CorpId，请从钉钉工作台重新进入应用。");
  const result = await saveFileToDingTalk({ url, name });
  const file = result.data?.[0];
  if (!file) throw new Error("未选择保存位置，请重试。");
  try {
    await previewFileInDingTalk({ ...file, corpId });
  } catch {
    throw new Error("文件已保存到钉盘，但未能打开预览。请到钉盘打开刚保存的文件进行转发或下载。");
  }
}
