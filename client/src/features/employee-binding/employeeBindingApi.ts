import type { EmployeeBindingStatus } from "../../../../shared/types";
import { request } from "../../shared/api/httpClient";

export const employeeBindingApi = {
  status: () => request<EmployeeBindingStatus>("/api/auth/employee-binding"),
  confirm: (employeeCode: string) => request<EmployeeBindingStatus>("/api/auth/employee-binding", {
    method: "POST", body: { employeeCode }
  })
};
