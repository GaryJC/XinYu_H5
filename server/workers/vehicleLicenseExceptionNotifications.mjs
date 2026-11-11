// License exceptions remain business records, but no longer send work notices.
// Keep the entry points inert for callers left over from earlier deployments.
export async function resolveLicenseExceptionManagers() { return false; }
export async function processLicenseExceptionNotification() { return false; }
export function startVehicleLicenseExceptionNotifications() { return async()=>{}; }
