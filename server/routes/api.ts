import crypto from "crypto";
import express from "express";
import { Request, Response } from "express";
import WebSocket from "ws";
// @ts-ignore
import patch from "express-ws/lib/add-ws-method";

import { WAState } from "whatsapp-web.js";

import { SessionStatus, SyncOptions } from "../../interfaces/api";
import { initWhatsApp } from "../src/whatsapp";
import { initSync } from "../src/sync";
import { generateGoogleAuthUrl, getOAuth2ClientFromCode } from "../src/gapi";
import { deleteFromCache, getFromCache, setInCache } from "../src/cache";
import { enforcePayments } from "../main";
import { checkPurchase } from "../src/payments";

// Based on https://github.com/HenningM/express-ws/issues/86
const router = express.Router({ mergeParams: true });
patch(router);

function cleanup(sessionID: string) {
  /*
    Cleanup the session and client objects.
    This is done with a timeout to prevent cleanup on websocket disconnect
      and re-connect (for example, during a page refresh).
  */
  const timeout = setTimeout(async () => {
    if (getFromCache(sessionID, "whatsapp") !== undefined) {
      try {
        const client = getFromCache(sessionID, "whatsapp");
        deleteFromCache(sessionID, "whatsapp");
        client.destroy();
      } catch (e) {}
    }

    deleteFromCache(sessionID, "gauth");
    deleteFromCache(sessionID, "ws");
  }, 5 * 60 * 1000); // 5 minutes.

  setInCache(sessionID, "cleanup", timeout);
}

router.get("/", (req: Request, res: Response) => {
  res.send("{}");
});

router.ws("/ws", (ws: WebSocket, req: Request) => {
  if (getFromCache(req.sessionID, "cleanup") !== undefined) {
    clearTimeout(getFromCache(req.sessionID, "cleanup"));
    deleteFromCache(req.sessionID, "cleanup");
  }

  ws.addEventListener("close", () => cleanup(req.sessionID));
  setInCache(req.sessionID, "ws", ws);
});

// Used by route guard
// Races a promise against a deadline, always clearing the timer so a slow
// probe can't leave a dangling handle behind.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

router.get("/status", async (req: Request, res: Response) => {
  const client = getFromCache(req.sessionID, "whatsapp");

  /*
    Probing `client.getState()` goes through the same puppeteer page that a
    running sync hammers with profile-pic requests. Under that load the probe
    stalls or throws, and answering `false` makes the frontend's router guard
    bounce the user off /sync back to the landing page mid-sync.

    A failed probe is not evidence of a disconnect, so we fall back to the last
    state we actually observed, and skip probing altogether while a sync is
    running — the sync driving that client is itself proof it works.
  */
  let whatsappConnected = false;
  if (client !== undefined) {
    if (getFromCache(req.sessionID, "syncing") === true) {
      whatsappConnected = true;
    } else {
      try {
        whatsappConnected =
          (await withTimeout(client.getState(), 2000)) === WAState.CONNECTED;
        setInCache(req.sessionID, "whatsappConnected", whatsappConnected);
      } catch {
        whatsappConnected = getFromCache(req.sessionID, "whatsappConnected") === true;
      }
    }
  }

  const status: SessionStatus = {
    whatsappConnected,
    googleConnected: getFromCache(req.sessionID, "gauth") !== undefined,
    enforcePayments,
    purchased: enforcePayments
      ? getFromCache(req.sessionID, "purchased")
      : true,
  };

  res.send(status);
});

router.get("/init_whatsapp", async (req: Request, res: Response) => {
  if (getFromCache(req.sessionID, "whatsapp") !== undefined)
    try {
      const client = getFromCache(req.sessionID, "whatsapp");
      deleteFromCache(req.sessionID, "whatsapp");
      client.destroy();
    } catch (e) {}

  const client = initWhatsApp(req.sessionID);
  setInCache(req.sessionID, "whatsapp", client);
  res.send("{}");
});

router.get("/google_auth_start", (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString("hex");
  setInCache(req.sessionID, "oauth_state", state);
  const redirectUri = `${req.protocol}://${req.get("host")}/api/google_callback`;
  const authUrl = generateGoogleAuthUrl(redirectUri, state);
  res.redirect(authUrl);
});

router.get("/google_callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect("/?error=google_auth_denied");
  }

  const storedState = getFromCache(req.sessionID, "oauth_state");
  if (!state || state !== storedState) {
    return res.redirect("/?error=invalid_state");
  }
  deleteFromCache(req.sessionID, "oauth_state");

  const redirectUri = `${req.protocol}://${req.get("host")}/api/google_callback`;
  try {
    const gAuth = await getOAuth2ClientFromCode(code as string, redirectUri);
    setInCache(req.sessionID, "gauth", gAuth);
    res.redirect("/options");
  } catch (e) {
    res.redirect("/?error=google_token_exchange_failed");
  }
});

router.get("/init_sync", (req: Request, res: Response) => {
  initSync(req.sessionID, req.query as SyncOptions);
  res.send("{}");
});

// Lets the frontend detect (e.g. after a page reload) that a sync is already
// running for this session, so it can attach to it instead of starting a new one.
router.get("/sync_status", (req: Request, res: Response) => {
  res.send({
    running: getFromCache(req.sessionID, "syncing") === true,
    progress: getFromCache(req.sessionID, "syncProgress") ?? null,
  });
});

router.post("/check_purchase", async (req: Request, res: Response) => {
  const email = req.body.email;
  const purchased = await checkPurchase(email);
  setInCache(req.sessionID, "purchased", purchased);
  setInCache(req.sessionID, "email", email);
  res.send({ purchased });
});

export default router;
