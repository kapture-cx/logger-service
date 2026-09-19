import express from "express";
import {
  addIncidentChunk,
  addLogs,
  completeIncident,
  createIncident,
  fetchIncident,
  fetchIncidents,
  fetchLogs,
  fetchLogsByFilters,
  removeIncident,
} from "../controller/userController.js";
import sanitizeLogs from "../middlewares/sanitizeLogs.js";

const router = express.Router();

router.post("/logs", sanitizeLogs, addLogs);
router.get(["/logs", "/fetch-logs"], fetchLogs);
router.post("/logs/filter", fetchLogsByFilters);
router.post("/incidents", createIncident);
router.post("/incidents/:id/chunks", addIncidentChunk);
router.post("/incidents/:id/complete", completeIncident);
router.delete("/incidents/:id", removeIncident);
router.get("/incidents", fetchIncidents);
router.get("/incidents/:id", fetchIncident);

export default router;
