import { handleWebhook } from "../src/routes.js";

export default function handler(req, res) {
  return handleWebhook(req, res);
}
