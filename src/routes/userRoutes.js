import express from "express";
import {
  addIncidentChunk,
  addLogs,
  askAiInvestigator,
  completeIncident,
  createIncident,
  fetchLiveSession,
  fetchLiveSessions,
  fetchIncident,
  fetchIncidents,
  fetchLogs,
  fetchLogsByFilters,
  generateAiInvestigationQuestions,
  removeIncident,
  saveLiveSession,
} from "../controller/userController.js";
import sanitizeLogs from "../middlewares/sanitizeLogs.js";

const router = express.Router();

router.post("/logs", sanitizeLogs, addLogs);
router.get(["/logs", "/fetch-logs"], fetchLogs);
router.post("/logs/filter", fetchLogsByFilters);
router.post("/incidents", sanitizeLogs, createIncident);
router.post("/incidents/:id/chunks", sanitizeLogs, addIncidentChunk);
router.post("/incidents/:id/complete", sanitizeLogs, completeIncident);
router.delete("/incidents/:id", removeIncident);
router.get("/incidents", fetchIncidents);
router.get("/incidents/:id", fetchIncident);
router.post("/live-sessions", sanitizeLogs, saveLiveSession);
router.get("/live-sessions", fetchLiveSessions);
router.get("/live-sessions/:id", fetchLiveSession);
router.post("/ai-investigator/questions", generateAiInvestigationQuestions);
router.post("/ai-investigator/ask", askAiInvestigator);

export default router;
