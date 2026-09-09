export const CLIENT_MONITORING_CONFIG = {
  default: {
    EXACT_IGNORED_CONSOLE_MESSAGES: [
      "jwt_access_token exists: false NULL",
      "Registering the ping handler",
      "Registering the pong handler",
      "KaptureHandler Log: Connected.",
      "Material-UI: The Menu component doesn't accept a Fragment as a child.\nConsider providing an array instead.",
      "KaptureHandler Log: ECHOBOT: Send a message to empa120040@xmpp.adjetter.com/7941124308373112218431692040 to talk to me.",
    ],
    INCLUDED_IGNORED_CONSOLE_PHRASES: [
      "expiryTimestamp (ms) invalid",
      "Skipping registration",
      "Initiating PONG...",
      "FirebaseService",
      "Whoops! Lost connection to",
      "WebSocketService",
      "Web Socket",
      "Material-UI: The Menu component doesn't accept a Fragment as a child",
      "web_socket",
      "jwt_access_token",
      "KaptureHandler",
      "<<< MESSAGE", 
      ">>> CONNECT", 
      ">>> SUBSCRIBE", 
      ">>> SEND", 
      "PING", 
      "PONG"
    ],
    ignoredUrls: [
      "https://firebaselogging-pa.googleapis.com",
      "https://www.google-analytics.com",
      "https://analytics.google.com",
      "https://api.eu.amplitude.com",
    ],
  },
  415: {
    EXACT_IGNORED_CONSOLE_MESSAGES: ["Exact client message"],
    INCLUDED_IGNORED_CONSOLE_PHRASES: ["partial client phrase"],
    ignoredUrls: ["https://client-service.example.com"],
  },
};
