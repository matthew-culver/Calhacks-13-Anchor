# Email fixtures

Every `.eml` file in this folder (and in `private/`) runs through all the checks in
`npm test`. To add one:

1. Save the email as raw source. In Gmail: open it, ⋮ menu, **Download message**.
2. Drop the file here.
3. Add one line at the very top saying what the checks should decide:

   ```
   X-Anchor-Expected-Level: fake
   ```

   Use `real`, `unsure` or `fake`. Optionally pin single checks too:

   ```
   X-Anchor-Expected-Checks: claimed_identity=fail; link_audit=warn
   ```

   Check ids are the ones in `convex/contract.ts` (`header_auth`, `claimed_identity`,
   `link_audit`, `pressure`, `injection`) and statuses are `pass`, `warn`, `fail`, `unknown`.

Real emails from the family go in `private/`, which git ignores, so personal mail never
lands in the repo. Synthetic ones (like the five demo emails here) can be committed.

The checks only trust the `Authentication-Results` header that Gmail itself added
(`mx.google.com`), so keep Gmail's headers when you save a message.
