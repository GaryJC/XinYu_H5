// Preserve historical reminder records, but never scan or enqueue new reminders.
export async function dueReminderCandidates() { return []; }
export async function queueDueReminder() { return 0; }
