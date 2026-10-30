import type { PartsRequirement } from '../../../../shared/types';
export { partsStatus, canProcessParts } from '../../../../shared/warehouseRequests.mjs';

export function isSupplementalParts(parts?:PartsRequirement) {
  return (parts?.batch ?? 1)>1;
}
