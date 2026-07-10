export const dingTalkOrganizationAdapter = {
  async syncOrganization() {
    return {
      syncedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      users: 30
    };
  }
};
