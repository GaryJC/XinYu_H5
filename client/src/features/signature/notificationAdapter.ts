import { WorkOrder } from "../../../../shared/types";

export const signatureNotificationAdapter = {
  async sendSignatureTodo(order: WorkOrder) {
    await delay(250);
    return { sent: true, to: order.customer.phone, orderId: order.id };
  }
};

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
