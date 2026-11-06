import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_CHARS = 24_000;

const textExtensions = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".go",
  ".rs",
  ".html",
  ".css",
  ".sql",
  ".sh",
  ".yaml",
  ".yml",
  ".xml",
  ".log",
  ".toml",
  ".ini",
]);

export interface ExtractedAttachment {
  filename: string;
  contentType: string;
  text: string;
  truncated: boolean;
}

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

export async function extractTextFile(
  filename: string,
  buffer: Buffer,
): Promise<ExtractedAttachment> {
  if (buffer.length === 0) {
    throw new AttachmentError("The selected file is empty.");
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError("Files must be 5 MB or smaller.");
  }

  const safeName = path.basename(filename).slice(0, 160);
  const extension = path.extname(safeName).toLowerCase();
  let contentType: string;
  let rawText: string;

  if (extension === ".pdf") {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new AttachmentError("This file does not appear to be a valid PDF.");
    }
    try {
      const parsed = await pdfParse(buffer);
      rawText = parsed.text;
      contentType = "application/pdf";
    } catch {
      throw new AttachmentError("SPPY could not read text from this PDF.");
    }
  } else if (extension === ".docx") {
    if (buffer.subarray(0, 2).toString("ascii") !== "PK") {
      throw new AttachmentError("This file does not appear to be a valid DOCX document.");
    }
    try {
      const parsed = await mammoth.extractRawText({ buffer });
      rawText = parsed.value;
      contentType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } catch {
      throw new AttachmentError("SPPY could not read this DOCX document.");
    }
  } else if (textExtensions.has(extension)) {
    if (buffer.includes(0)) {
      throw new AttachmentError("Binary files are not supported.");
    }
    rawText = buffer.toString("utf8");
    contentType = "text/plain";
  } else {
    throw new AttachmentError(
      "Supported files: PDF, TXT, CSV, DOCX, Markdown, JSON, and common source-code files.",
    );
  }

  const normalized = rawText.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    throw new AttachmentError("No readable text was found in this file.");
  }

  return {
    filename: safeName,
    contentType,
    text: normalized.slice(0, MAX_ATTACHMENT_CHARS),
    truncated: normalized.length > MAX_ATTACHMENT_CHARS,
  };
}
