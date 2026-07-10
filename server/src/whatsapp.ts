import {
  Client,
  Contact,
  MessageMedia,
  RemoteWebCacheOptions,
} from "whatsapp-web.js";

import { sendEvent } from "./ws";
import { Base64 } from "./types";
import { EventType } from "../../interfaces/api";
import { deleteFromCache, getFromCache } from "./cache";
import { verifyPurchaseWAId } from "./payments";

const wwebVersion = "2.2407.3";
const clientOptions = {
  puppeteer: {
    executablePath:
      process.env.RUNNING_IN_DOCKER === "true"
        ? "/usr/bin/chromium-browser"
        : undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  },
  webVersionCache: {
    type: "remote",
    remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${wwebVersion}.html`,
  } as RemoteWebCacheOptions,
};

export function initWhatsApp(id: string): Client {
  const client = new Client(clientOptions);

  client.on("qr", (qr: string) => {
    let ws = getFromCache(id, "ws");
    sendEvent(ws, EventType.WhatsAppQR, qr);
  });

  client.on("loading_screen", async () => {
    let ws = getFromCache(id, "ws");
    sendEvent(ws, EventType.WhatsAppConnecting);
  });

  client.on("ready", async () => {
    let ws = getFromCache(id, "ws");
    const email = getFromCache(id, "email");

    if (await verifyPurchaseWAId(email, client.info.wid.user)) {
      sendEvent(ws, EventType.Redirect, "/gauth");
    } else {
      deleteFromCache(id, "whatsapp");
      deleteFromCache(id, "purchased");
      try {
        client.destroy();
      } catch (e) { }
      sendEvent(ws, EventType.Redirect, "/contribute?show_error=true");
    }
  });

  client.on("auth_failure", (msg) => { });

  client.initialize();
  return client;
}

export async function loadContacts(
  client: Client
): Promise<Map<string, string>> {
  const contacts: Contact[] = await client.getContacts();

  const contactsMap: Map<string, string> = new Map();
  contacts.forEach((contact) => {
    if (contact.id.user && contact.id._serialized)
      contactsMap.set(contact.id.user, contact.id._serialized);
  });

  return contactsMap;
}

export async function downloadFile(
  client: Client,
  whatsappId: string
): Promise<Base64 | null> {
  // getProfilePicUrl is flaky under the rapid bulk iteration of a full sync: it
  // intermittently throws or returns undefined for contacts that DO have a photo.
  // Retry a few times with a short backoff to recover these false negatives.
  const maxAttempts = 3;
  let photoUrl: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      photoUrl = await client.getProfilePicUrl(whatsappId);
      if (photoUrl) break;
    } catch (e) {
      lastError = e;
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  if (!photoUrl) {
    if (lastError) {
      console.log(`[sync] downloadFile ${whatsappId} — getProfilePicUrl threw after ${maxAttempts} attempts: ${(lastError as Error)?.message ?? lastError}`);
    } else {
      console.log(`[sync] downloadFile ${whatsappId} — getProfilePicUrl returned empty after ${maxAttempts} attempts (no photo / privacy restricted)`);
    }
    return null;
  }

  const image = await MessageMedia.fromUrl(photoUrl);
  return image.data;
}
