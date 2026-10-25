import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// A5: check every active family's Gmail for new mail.
crons.interval("check new mail", { minutes: 1 }, internal.mailWatch.pollAll, {});

// A6: retry Gmail actions and answers that didn't go through; finish interrupted turn-offs.
crons.interval("repair", { minutes: 5 }, internal.repair.repairAll, {});

export default crons;
