const axios = require("axios");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const logger = require("../logs/logger");

// Bounds how much resume/JD text ever reaches an LLM prompt.
const MAX_CHARS = 6000;

function truncate(text) {
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

// doc 04 §6: resumeReference is a public URL (from StorageService.getPublicUrl,
// see practywiz-backend's resolveResumeReference) pointing at whatever format
// the candidate originally uploaded via the existing mentee resume flow —
// PDF and DOCX are both real-world cases there, so both are handled.
async function extractTextFromUrl(url) {
  if (!url) return null;
  try {
    const response = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(response.data);
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const lowerUrl = url.toLowerCase();

    if (contentType.includes("pdf") || lowerUrl.endsWith(".pdf")) {
      const parsed = await pdfParse(buffer);
      return truncate(parsed.text.trim());
    }
    if (contentType.includes("wordprocessingml") || lowerUrl.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      return truncate(result.value.trim());
    }
    // Fallback: treat as plain text (covers .txt and unexpected content-types)
    return truncate(buffer.toString("utf8").trim());
  } catch (err) {
    logger.warn("extractTextFromUrl failed:", err.message);
    return null;
  }
}

module.exports = { extractTextFromUrl };
