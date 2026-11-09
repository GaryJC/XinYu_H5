import type { WorkOrderDraft } from "./types";
export function legacyTextBytes(value: unknown): number;
export function legacyTextError(value: unknown, maxBytes: number, label: string): string;
export function legacyReferenceNameError(kind: string, name: string): string;
export function legacyOrderInputErrors(order: Partial<WorkOrderDraft>): string[];
