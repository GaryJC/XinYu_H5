// Older orders predate authenticated owner IDs and only carry a name snapshot.
export function isOrderAdvisor(advisorUserId, advisorName, user) {
  if (advisorUserId != null) return Boolean(user?.id && advisorUserId === user.id);
  return Boolean(user?.name && advisorName === user.name);
}
