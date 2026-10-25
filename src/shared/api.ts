// Mocked stand-ins for Person A's Convex functions. Each one has the same shape as
// the real function, so swapping is a one-line change per call site at Checkpoint 1.

/** Mock of A2's kid sign-up. The real one is Convex Auth: signIn("password", { flow: "signUp", ... }). */
export async function signUp(args: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  void args;
}

/** Mock of A2's createFamily mutation: makes the family and its single-use invite token. */
export async function createFamily(args: {
  parentName: string;
  parentEmail: string;
  kidName: string;
}): Promise<{ inviteToken: string }> {
  void args;
  // Same randomness rule as the contract: at least 128 random bits.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const inviteToken = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return { inviteToken };
}
