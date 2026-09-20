import { getIncidentInvestigationEvidence } from "./models/useModel.js";

export const loadInvestigationEvidence = ({ sourceType, sourceId } = {}) => {
  if (sourceType !== "incident") {
    throw new TypeError("Unsupported AI investigation source");
  }

  return getIncidentInvestigationEvidence(sourceId);
};
