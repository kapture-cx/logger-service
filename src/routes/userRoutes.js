import express from "express";
import {
  addLogs,
  fetchLogs,
  fetchLogsByFilters,
} from "../controller/userController.js";
import sanitizeLogs from "../middlewares/sanitizeLogs.js";

const router = express.Router();

router.post("/logs", sanitizeLogs, addLogs);
router.get(["/logs", "/fetch-logs"], fetchLogs);
router.post("/logs/filter", fetchLogsByFilters);

export default router;
