import { createEmployeeBindingService } from "../domain/employeeBinding.mjs";
import { findLegacyEmployeesByName } from "../repositories/legacyEmployeeRepository.mjs";
import { saveEmployeeBinding } from "../repositories/employeeBindingRepository.mjs";
export const employeeBindingService = createEmployeeBindingService({
  findEmployees: findLegacyEmployeesByName, saveBinding: saveEmployeeBinding
});
