import {
  getIncidentInvestigationEvidence,
  getLiveSessionInvestigationEvidence,
} from "./models/useModel.js";

export const loadInvestigationEvidence = ({ sourceType, sourceId } = {}) => {
  if (sourceType === "incident") {
    return getIncidentInvestigationEvidence(sourceId);
  }

  if (sourceType === "live-session") {
    return getLiveSessionInvestigationEvidence(sourceId);
  }

  throw new TypeError("Unsupported AI investigation source");
};
