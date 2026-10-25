// A believable two-year inbox for demo mode (A4): builds My Accounts without live Gmail.
// Headers only, like the real import. Includes a spoofed "Chase" that fails DMARC, which
// must NOT become one of the parent's accounts.

import type { HeaderRecord } from "./history";

const DAY = 24 * 60 * 60 * 1000;
const PASS = ["mx.google.com; spf=pass; dkim=pass; dmarc=pass (p=REJECT)"];
const FAIL = ["mx.google.com; spf=fail; dkim=none; dmarc=fail (p=REJECT)"];
const PARENT = "Mom <mom.culver@gmail.com>";

// [From, how many emails, first seen (days ago)]
const SENDERS: [string, number, number][] = [
  ["Kaiser Permanente <noreply@kp.org>", 60, 700],
  ["Kaiser Permanente <messages@kaiserpermanente.org>", 30, 650],
  ["Wells Fargo <alerts@notify.wellsfargo.com>", 90, 720],
  ["CVS Pharmacy <CVSPharmacy@pharmacy.cvs.com>", 40, 560],
  ["PG&E <customerservice@notifications.pge.com>", 24, 720],
  ["Medicare <noreply@medicare.gov>", 8, 420],
  ["Social Security <noreply@ssa.gov>", 4, 360],
  ["Amazon.com <shipment-tracking@amazon.com>", 120, 720],
  ["AARP <member@email.aarp.org>", 20, 500],
  ["Aunt Sue <sue.culver@gmail.com>", 35, 720],
  ["Lucas <lucas@example.com>", 50, 720],
  ["Sunrise Senior Center <news@sunrisecenter.org>", 17, 270],
];

export function sampleRecords(now = Date.now()): HeaderRecord[] {
  const records: HeaderRecord[] = [];
  for (const [from, count, firstDaysAgo] of SENDERS) {
    for (let i = 0; i < count; i++) {
      const daysAgo = Math.round(firstDaysAgo - (firstDaysAgo * i) / count);
      records.push({ from, to: PARENT, authResults: PASS, date: now - daysAgo * DAY, sent: false });
    }
  }
  for (let i = 0; i < 12; i++) {
    records.push({ from: PARENT, to: "Aunt Sue <sue.culver@gmail.com>", authResults: [], date: now - i * 30 * DAY, sent: true });
  }
  records.push(
    { from: "Chase <alerts@chase.com>", to: PARENT, authResults: FAIL, date: now - 2 * DAY, sent: false },
    { from: "Chase Bank <security@chase-secure-login.co>", to: PARENT, authResults: FAIL, date: now - DAY, sent: false },
  );
  return records;
}
