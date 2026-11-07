// Route event pesan WhatsApp ke controller pesan.
import { registerMessageRoutes } from "../controllers/messageController.js";

export function attachMessageRoutes(client, getIsReady) {
  registerMessageRoutes(client, getIsReady);
}
