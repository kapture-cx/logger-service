import { buildDetections } from "./detectionEngine.js";
import { sendDetectionEmail } from "./detectionEmail.js";
import {
  getRecentDetectionEvents,
  markDetectionEmailed,
  upsertDetection,
} from "./models/useModel.js";

export async function runDetections({
  loadEvents = getRecentDetectionEvents,
  saveDetection = upsertDetection,
  sendEmail = sendDetectionEmail,
  markEmailed = markDetectionEmailed,
} = {}) {
  try {
    const detections = buildDetections(await loadEvents());

    for (const detection of detections) {
      const saved = await saveDetection(detection);

      if (
        ["high", "critical"].includes(saved.severity) &&
        !saved.emailSentAt
      ) {
        try {
          if (await sendEmail(saved)) {
            await markEmailed(saved.id);
          }
        } catch (error) {
          console.error(`Failed to email detection ${saved.id}`, error);
        }
      }
    }

    return detections.length;
  } catch (error) {
    console.error("Failed to run automatic detections", error);
    return 0;
  }
}
