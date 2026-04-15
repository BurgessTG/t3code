import { PatchServiceError } from "./Errors.ts";

export function patchServiceError(operation: string, detail: string, cause?: unknown) {
  return new PatchServiceError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}
