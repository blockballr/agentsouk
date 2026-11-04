import { handleHealth } from "../src/routes.js";

export default function handler(req, res) {
  return handleHealth(req, res);
}
