import { ExtractAiAttachmentResponse } from "@workspace/api-zod";
import { AttachmentError, extractTextFile, MAX_ATTACHMENT_BYTES } from "@workspace/sppy-ai";
import { json } from "../lib/shared.mjs";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Choose one file to attach." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Choose one file to attach." }, 400);
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return json({ error: "Files must be 5 MB or smaller." }, 400);
  }

  try {
    const extracted = await extractTextFile(
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );
    return json(ExtractAiAttachmentResponse.parse(extracted));
  } catch (error) {
    if (error instanceof AttachmentError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "SPPY could not read this file." }, 400);
  }
}
