import os from "os";
import path from "path";

export function dataDir() {
  return process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai");
}

export function uploadsDir() {
  return path.join(dataDir(), "uploads");
}

export function skillsDir() {
  return path.join(dataDir(), "skills");
}

export function studioDir() {
  return path.join(dataDir(), "studio");
}
