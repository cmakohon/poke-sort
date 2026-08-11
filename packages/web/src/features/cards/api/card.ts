import type { IdentifyResult, Result } from "@poke-sort/shared";
import { apiPostForm } from "@/lib/api/client";

export async function searchByImage(
  formData: FormData,
): Promise<Result<IdentifyResult | null>> {
  return apiPostForm<Result<IdentifyResult | null>>("/api/cards", formData);
}
