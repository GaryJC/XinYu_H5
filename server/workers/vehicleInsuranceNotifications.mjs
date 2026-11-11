// Insurance remains required for driving; only its work notifications are disabled.
export async function queueInsuranceReminders() {}
export async function deliverInsuranceReminder() { return false; }
export function startVehicleInsuranceNotifications() { return async()=>{}; }
