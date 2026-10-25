// Without this file every request is silently signed out.
// Convex Auth issues its own JWTs from this deployment's site URL.
const authConfig = {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
