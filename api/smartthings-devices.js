import { listSmartThingsDevices } from "../lib/smartthings.js";

function isAuthorized(request) {
  const secret = process.env.TRACKER_UPDATE_SECRET;

  if (!secret) {
    return false;
  }

  return request.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const data = await listSmartThingsDevices();
    const devices = (data.items || []).map((device) => ({
      deviceId: device.deviceId,
      name: device.name,
      label: device.label,
      type: device.type,
      manufacturerName: device.manufacturerName,
      capabilities: (device.components || []).flatMap((component) =>
        (component.capabilities || []).map((capability) => capability.id),
      ),
    }));

    return response.status(200).json({ devices });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
