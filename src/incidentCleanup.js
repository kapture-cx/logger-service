import { deleteAbandonedIncidents } from "./models/useModel.js";

export async function runIncidentCleanup() {
  try {
    const deletedCount = await deleteAbandonedIncidents();

    if (deletedCount > 0) {
      console.log(`Deleted ${deletedCount} abandoned incident recording(s)`);
    }

    return deletedCount;
  } catch (error) {
    console.error("Failed to clean up abandoned incident recordings", error);
    return 0;
  }
}
