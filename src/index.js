import "dotenv/config";
import pool from "./config/db.js";
import createLogsTable from "./data/createUserTable.js";
import { createApp, getAllowedOrigins } from "./app.js";
import { runIncidentCleanup } from "./incidentCleanup.js";
import { attachLiveMonitoring } from "./liveMonitoring.js";

const port = Number(process.env.PORT) || 3001;
const INCIDENT_CLEANUP_INTERVAL = 15 * 60 * 1000;

const startServer = async () => {
  try {
    await createLogsTable();
    await runIncidentCleanup();

    const incidentCleanupTimer = setInterval(
      runIncidentCleanup,
      INCIDENT_CLEANUP_INTERVAL,
    );
    incidentCleanupTimer.unref();

    const allowedOrigins = getAllowedOrigins();
    const app = createApp({ allowedOrigins });

    const server = app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });

    attachLiveMonitoring(server, { allowedOrigins });
  } catch (error) {
    console.error("Failed to initialize the database", error);
    process.exitCode = 1;
    await pool.end();
  }
};

startServer();
