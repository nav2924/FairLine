import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "queue-events.jsonl");

export function logEvent(obj) {
  try {
    const line = JSON.stringify(obj);
    fs.appendFile(LOG_FILE, line + "\n", () => {});
  } catch (e) {}
}
