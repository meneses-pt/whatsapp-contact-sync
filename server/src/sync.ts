import WebSocket from "ws";
import { Auth } from "googleapis";
import { RateLimiter } from "limiter";
import { Client } from "whatsapp-web.js";

import { EventType, SyncOptions } from "../../interfaces/api";
import { listContacts, updateContactPhoto } from "./gapi";
import { downloadFile, loadContacts } from "./whatsapp";
import { sendEvent, sendMessageAndWait } from "./ws";
import { SimpleContact } from "./interfaces";
import { getFromCache, setInCache, deleteFromCache } from "./cache";
import { inferRegion, matchCandidates } from "./phone";

// How long to keep a sync running after the client's websocket goes away, so a
// page reload (which briefly drops and re-opens the socket) doesn't kill it.
const DISCONNECT_GRACE_MS = 20000;

const getGooglePhotoAsBase64 = async (googleContact: SimpleContact): Promise<string | null> => {
  if (!googleContact.photoUrl) {
    return null;
  }
  const googlePhotoData = await fetch(googleContact.photoUrl);
  const googlePhotoBlob = await googlePhotoData.blob();
  const googlePhotoArrayBuffer = await googlePhotoBlob.arrayBuffer();
  return googlePhotoArrayBuffer.byteLength !== 0 ? Buffer.from(googlePhotoArrayBuffer).toString("base64") : null;
}

export async function initSync(id: string, syncOptions: SyncOptions) {
  // Prevent a second concurrent sync for the same session. A page reload
  // re-triggers /init_sync while the previous run is still going; without this
  // guard both loops run in parallel and blow past Google's rate limit.
  if (getFromCache(id, "syncing")) {
    console.log("[sync] init_sync ignored — a sync is already running for this session");
    return;
  }
  setInCache(id, "syncing", true);

  try {
    await runSync(id, syncOptions);
  } finally {
    deleteFromCache(id, "syncing");
  }
}

async function runSync(id: string, syncOptions: SyncOptions) {
  // The limiter is implemented due to Google API's limit of 60 photo uploads per minute per user
  const limiter = new RateLimiter({ tokensPerInterval: 1, interval: 1500 });

  const whatsappClient: Client = getFromCache(id, "whatsapp");
  const gAuth: Auth.OAuth2Client = getFromCache(id, "gauth");

  // Always resolve the *latest* websocket for this session, so a client that
  // reconnected after a reload keeps receiving progress (the old socket is dead).
  const currentWs = (): WebSocket | undefined => getFromCache(id, "ws");

  let lastSeenOpen = Date.now();
  const clientGone = (): boolean => {
    const ws = currentWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      lastSeenOpen = Date.now();
      return false;
    }
    // Tolerate a short gap (reload) before giving up on the client.
    return Date.now() - lastSeenOpen > DISCONNECT_GRACE_MS;
  };

  // Send progress to the current socket and stash a lightweight copy (no image)
  // in the cache so /sync_status can report an in-progress sync after a reload.
  const emitProgress = (data: any): void => {
    const { image, ...status } = data;
    setInCache(id, "syncProgress", status);
    const ws = currentWs();
    if (ws && ws.readyState === WebSocket.OPEN) sendEvent(ws, EventType.SyncProgress, data);
  };

  let googleContacts: SimpleContact[];
  let whatsappContacts: Map<string, string>;

  try {
    googleContacts = await listContacts(gAuth);
    whatsappContacts = await loadContacts(whatsappClient);
    emitProgress({
      progress: 0,
      syncCount: 0,
      isManualSync: syncOptions.manual_sync === "true",
    });
  } catch (e) {
    console.error(e);
    emitProgress({
      progress: 0,
      syncCount: 0,
      error: "Failed to load contacts, please try again.",
    });
    return;
  }

  let syncCount: number = 0;
  let photo: string | null = null;

  // The syncing user's own number tells us the default country to assume for
  // contacts saved without a `+CC` prefix.
  const region = inferRegion(whatsappClient.info?.wid?.user);

  // For some reason all of the contacts that don't have a photo are at the beginning of the array.
  // This causes the sync to feel slow since no photos show up on the UI.
  // To "fix" this, we shuffle the array so that the contacts without photos are spread out.
  const shuffledGoogleContacts = googleContacts.sort(() => Math.random() - 0.5);

  for (const [index, googleContact] of shuffledGoogleContacts.entries()) {
    if (clientGone()) {
      console.log("[sync] stopping — client disconnected for more than the grace period");
      return;
    }

    const isManualSync = syncOptions.manual_sync === "true";
    const label = `${googleContact.name ?? "(no name)"} [${googleContact.numbers.join(", ") || "no numbers"}]`;

    if (!isManualSync && syncOptions.overwrite_photos === "false" && googleContact.hasPhoto) {
      console.log(`[sync] SKIP ${label} — already has a Google photo and overwrite is off`);
      continue;
    }

    // Guard each contact: initSync runs un-awaited, so a throw here (e.g. a bad
    // photo URL) would become an unhandled rejection that silently ends the
    // entire sync. Log it and move on to the next contact instead.
    let matched = false;
    try {
      for (const phoneNumber of googleContact.numbers) {
        let whatsappContactId: string | undefined;

        // Normalize the Google number and try it against the WhatsApp map along
        // with country-specific legacy spellings (e.g. Brazil's extra '9',
        // Mexico's mobile '1'), matching on the first candidate that hits.
        for (const candidate of matchCandidates(phoneNumber, region)) {
          whatsappContactId = whatsappContacts.get(candidate);
          if (whatsappContactId) break;
        }
        if (!whatsappContactId) continue;
        matched = true;

        photo = await downloadFile(whatsappClient, whatsappContactId);
        if (photo === null) {
          console.log(`[sync] SKIP ${label} — matched WhatsApp ${phoneNumber} but no profile photo available (none set or private)`);
          break;
        }

        await limiter.removeTokens(1);

        if (isManualSync) {
          const ws = currentWs();
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            // Manual sync needs a live socket to ask the user; skip if none.
            break;
          }
          let message: any;
          try {
            const googlePhoto = await getGooglePhotoAsBase64(googleContact);

            message = await sendMessageAndWait(ws,
              EventType.SyncConfirm,
              EventType.SyncPhotoConfirm,
              {
                existingPhoto: googlePhoto,
                newPhoto: photo,
                contactName: googleContact.name,
              });
          } catch (e) {
            console.error("Error waiting for response message for manual sync confirmation", e);
            continue;
          }

          if (message.accept) {
            console.log(`[sync] UPDATE ${label} — manual sync accepted`);
            await updateContactPhoto(gAuth, googleContact.id, photo);
          } else {
            console.log(`[sync] SKIP ${label} — manual sync rejected by user`);
          }
        } else {
          console.log(`[sync] UPDATE ${label} — uploading WhatsApp photo`);
          await updateContactPhoto(gAuth, googleContact.id, photo);
        }

        syncCount++;

        break;
      }
    } catch (e) {
      console.error(`Error syncing contact ${googleContact.id}:`, e);
    }

    if (!matched) {
      console.log(`[sync] SKIP ${label} — no matching WhatsApp contact for any of its numbers`);
    }

    emitProgress({
      progress: (index / googleContacts.length) * 100,
      syncCount: syncCount,
      totalContacts: googleContacts.length,
      image: photo,
      isManualSync,
    });
    photo = null;
  }

  emitProgress({
    progress: 100,
    syncCount: syncCount,
  });

  const ws = currentWs();
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
}
