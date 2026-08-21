const adminConfigRepository = require("./adminConfigRepository");
const logger = require("../logs/logger");

// Interview Room MCQ interaction type: interactionType/mcqCount are both
// optional (a section omitting them behaves exactly as it did before this
// feature existed — see question-engine/interactionTypePlan.js's defaults) —
// only validated when actually present, same permissive-JSON convention
// already established for evaluation_criteria.weights.
const VALID_INTERACTION_TYPES = new Set(["VOICE_QA", "MCQ", "MIXED"]);

function isValidConfiguration(configuration) {
  if (!configuration || !Array.isArray(configuration.sections) || configuration.sections.length === 0) return false;
  return configuration.sections.every((section) => {
    if (!section || typeof section.name !== "string" || !section.name.trim()) return false;
    if (!Number.isInteger(section.targetQuestions) || section.targetQuestions < 0) return false;
    if (section.interactionType !== undefined && !VALID_INTERACTION_TYPES.has(section.interactionType)) return false;
    if (
      section.interactionType === "MIXED" &&
      section.mcqCount !== undefined &&
      (!Number.isInteger(section.mcqCount) || section.mcqCount < 0 || section.mcqCount > section.targetQuestions)
    ) {
      return false;
    }
    return true;
  });
}

async function listConfigurations(req, res) {
  try {
    const configurations = await adminConfigRepository.listConfigurations();
    return res.status(200).json({ success: true, configurations });
  } catch (error) {
    logger.error("listConfigurations error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to load configurations" });
  }
}

async function createConfiguration(req, res) {
  const { name, configuration, estimatedDurationMinutes } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: "name is required" });
  }
  if (!isValidConfiguration(configuration)) {
    return res.status(400).json({
      success: false,
      error: "configuration.sections must be a non-empty array of {name, targetQuestions}",
    });
  }

  try {
    const id = await adminConfigRepository.createConfiguration({ name, configuration, estimatedDurationMinutes });
    return res.status(201).json({ success: true, id });
  } catch (error) {
    logger.error("createConfiguration error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to create configuration" });
  }
}

async function activateConfiguration(req, res) {
  const { id } = req.params;
  try {
    await adminConfigRepository.activateConfiguration(id);
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error("activateConfiguration error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to activate configuration" });
  }
}

module.exports = { listConfigurations, createConfiguration, activateConfiguration };
