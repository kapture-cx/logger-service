import { record } from "@rrweb/record";

Object.defineProperty(window, "__KaptureIncidentRecorder", {
  value: Object.freeze({ record }),
  writable: false,
  configurable: false,
});
