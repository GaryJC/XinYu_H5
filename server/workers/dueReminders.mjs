// Deadline pushes are retired. Keep old callers inert without database or roster reads.
export async function queueDueReminders() { return 0; }
export async function validateDueReminder() { return false; }
