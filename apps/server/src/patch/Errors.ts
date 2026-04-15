import { Schema } from "effect";

export class PatchServiceError extends Schema.TaggedErrorClass<PatchServiceError>()(
  "PatchServiceError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Patch service error in ${this.operation}: ${this.detail}`;
  }
}
