import { readProgress } from "../lib/progressStore.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const progress = await readProgress();
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json(progress);
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
