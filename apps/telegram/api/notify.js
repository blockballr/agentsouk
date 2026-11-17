import { handleNotify } from "../src/routes.js";

export default function handler(req, res) {
  return handleNotify(req, res);
}
