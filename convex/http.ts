import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Convex Auth's sign-in endpoints and JWKS.
auth.addHttpRoutes(http);

// A3 adds /gmail/start and /gmail/callback here.

export default http;
