import {
  addLogs as addLogsModel,
  appendIncidentChunk,
  completeIncident as completeIncidentModel,
  createIncident as createIncidentModel,
  deleteIncident as deleteIncidentModel,
  getAllLogs,
  getIncident as getIncidentModel,
  getIncidents as getIncidentsModel,
  getLogsByFilters,
} from "../models/useModel.js";
import { loadInvestigationEvidence } from "../investigationEvidence.js";
import {
  answerInvestigationQuestion,
  generateInvestigationQuestions,
} from "../aiInvestigator.js";

const flatEvents = (logs) => {
  return logs.flatMap((log) =>
    log.events.map((event) => ({
      ...event,
      app: log.app,
      clientDetails: log.client_details,
    })),
  );
};

export const handleResponse = (res, status, message, data = null) => {
  return res.status(status).json({
    status,
    message,
    data,
  });
};

export const fetchLogs = async (_req, res, next) => {
  try {
    const logs = await getAllLogs();
    const flatLogs = flatEvents(logs);
    return handleResponse(res, 200, "Logs fetched successfully", flatLogs);
  } catch (error) {
    return next(error);
  }
};

export const addLogs = async (req, res, next) => {
  try {
    const log = await addLogsModel(req.body);
    return handleResponse(res, 201, "Logs added successfully", log);
  } catch (error) {
    return next(error);
  }
};

export const fetchLogsByFilters = async (req, res, next) => {
  try {
    const events = await getLogsByFilters(req.body);

    if (events.length === 0) {
      return handleResponse(
        res,
        404,
        "No events found for the supplied filters",
        [],
      );
    }

    return handleResponse(res, 200, "Events fetched successfully", events);
  } catch (error) {
    return next(error);
  }
};

export const createIncident = async (req, res, next) => {
  try {
    return handleResponse(
      res,
      201,
      "Incident recording started",
      await createIncidentModel(req.body),
    );
  } catch (error) {
    return next(error);
  }
};

export const addIncidentChunk = async (req, res, next) => {
  try {
    return handleResponse(
      res,
      200,
      "Replay chunk stored",
      await appendIncidentChunk(req.params.id, req.body),
    );
  } catch (error) {
    return next(error);
  }
};

export const completeIncident = async (req, res, next) => {
  try {
    return handleResponse(
      res,
      200,
      "Incident completed",
      await completeIncidentModel(req.params.id, req.body),
    );
  } catch (error) {
    return next(error);
  }
};

export const removeIncident = async (req, res, next) => {
  try {
    return handleResponse(
      res,
      200,
      "Incident discarded",
      await deleteIncidentModel(req.params.id),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchIncident = async (req, res, next) => {
  try {
    return handleResponse(
      res,
      200,
      "Incident fetched successfully",
      await getIncidentModel(req.params.id),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchIncidents = async (req, res, next) => {
  try {
    return handleResponse(
      res,
      200,
      "Incidents fetched successfully",
      await getIncidentsModel(req.query),
    );
  } catch (error) {
    return next(error);
  }
};

export const generateAiInvestigationQuestions = async (req, res, next) => {
  try {
    const { sourceType, sourceId } = req.body || {};
    const evidence = await loadInvestigationEvidence({ sourceType, sourceId });
    const questions = await generateInvestigationQuestions(evidence);

    return handleResponse(
      res,
      200,
      "Investigation questions generated successfully",
      { sourceType, sourceId, questions },
    );
  } catch (error) {
    return next(error);
  }
};

export const askAiInvestigator = async (req, res, next) => {
  try {
    const { sourceType, sourceId, question } = req.body || {};

    if (typeof question !== "string" || !question.trim()) {
      throw new TypeError("question must be a non-empty string");
    }

    if (question.trim().length > 1000) {
      throw new TypeError("question must not exceed 1000 characters");
    }

    const evidence = await loadInvestigationEvidence({ sourceType, sourceId });
    const answer = await answerInvestigationQuestion(
      evidence,
      question.trim(),
    );

    return handleResponse(
      res,
      200,
      "Investigation question answered successfully",
      { sourceType, sourceId, question: question.trim(), ...answer },
    );
  } catch (error) {
    return next(error);
  }
};
