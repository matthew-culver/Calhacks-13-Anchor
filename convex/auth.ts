// Kid sign-in (Convex Auth, email + password).
// The parent never signs in here: they use the invite link, then Google OAuth for Gmail (A3).

import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
