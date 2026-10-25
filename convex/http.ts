import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { callback, start } from "./gmailConnect";

const http = httpRouter();

// Convex Auth's sign-in endpoints and JWKS.
auth.addHttpRoutes(http);

// The parent's one tap: invite page form → Google → back here (A3).
http.route({ path: "/gmail/start", method: "POST", handler: start });
http.route({ path: "/gmail/callback", method: "GET", handler: callback });

export default http;
