import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// A5: check every active family's Gmail for new mail.
crons.interval("check new mail", { minutes: 1 }, internal.mailWatch.pollAll, {});

export default crons;
