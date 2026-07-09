import { WorkOrder } from "../../shared/types";

export const dingTalkAuthAdapter = {
  async getCurrentUser() {
    return { dingUserId: "mock-dingtalk-user-001", name: "林佳", shopId: "shop-hq", shopName: "上海虹桥店" };
  },
  async syncOrganization() {
    return { syncedAt: new Date().toLocaleString("zh-CN", { hour12: false }), users: 30 };
  }
};

export const fileUploadAdapter = {
  async uploadImage(source: string) {
    return { fileId: `mock-file-${Date.now()}`, source };
  }
};

export const notificationAdapter = {
  async sendSignatureTodo(order: WorkOrder) {
    await delay(250);
    return { sent: true, to: order.customer.phone, orderId: order.id };
  }
};

export const repairPlatformAdapter = {
  async pushWorkOrder(_order: WorkOrder) {
    return { skipped: true, reason: "维修业务平台接口暂缓对接" };
  }
};

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
