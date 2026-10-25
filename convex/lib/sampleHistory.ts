// A believable two-year inbox for demo mode (A4): builds My Accounts without live Gmail.
// Headers only, like the real import. Includes a spoofed "Chase" that fails DMARC, which
// must NOT become one of the parent's accounts. A8: subjects make the ranking real: account
// mail (statements, bills, appointments...) from the accounts Mom uses, and marketing,
// receipts or an old insurer that should not show up.

import type { HeaderRecord } from "./history";

const DAY = 24 * 60 * 60 * 1000;
const PASS = ["mx.google.com; spf=pass; dkim=pass; dmarc=pass (p=REJECT)"];
const FAIL = ["mx.google.com; spf=fail; dkim=none; dmarc=fail (p=REJECT)"];
const PARENT = "Mom <mom@example.com>";

// [From, how many emails, first seen (days ago), last seen (days ago), subjects (taken in turn)]
const SENDERS: [string, number, number, number, string[]][] = [
  ["Kaiser Permanente <noreply@kp.org>", 60, 700, 2, ["Appointment reminder", "New test results are available", "You have a new message from your doctor"]],
  ["Kaiser Permanente <messages@kaiserpermanente.org>", 30, 650, 9, ["Your Kaiser Permanente newsletter"]],
  ["Wells Fargo <alerts@notify.wellsfargo.com>", 90, 720, 1, ["Your statement is ready", "New sign-in to Wells Fargo Online", "Your payment is scheduled"]],
  ["CVS Pharmacy <CVSPharmacy@pharmacy.cvs.com>", 40, 560, 4, ["Your prescription is ready for pickup", "Your refill is on the way"]],
  ["PG&E <customerservice@notifications.pge.com>", 24, 720, 6, ["Your PG&E bill is ready", "Thank you for your payment"]],
  ["Medicare <noreply@medicare.gov>", 8, 420, 35, ["Your Medicare Summary Notice is available"]],
  ["Social Security <noreply@ssa.gov>", 4, 360, 60, ["Your benefit letter is ready"]],
  ["Amazon.com <shipment-tracking@amazon.com>", 120, 720, 1, ["Your order has shipped", "Your package was delivered"]],
  ["Netflix <info@account.netflix.com>", 24, 720, 12, ["Your monthly bill"]],
  ["AARP <member@email.aarp.org>", 20, 500, 5, ["This week's AARP newsletter"]],
  ["Sutter Health <news@sutterhealth.org>", 25, 600, 3, ["Healthy living tips for fall"]],
  ["Apple <no_reply@email.apple.com>", 15, 500, 20, ["Your receipt from Apple"]],
  ["Blue Shield of California <noreply@blueshieldca.com>", 12, 720, 450, ["Your explanation of benefits is ready"]],
  ["Bayview Family Dental <reminders@bayviewdental.example>", 6, 300, 14, ["Appointment reminder"]],
  ["Aunt Sue <sue@example.com>", 35, 720, 2, ["Pictures from the weekend"]],
  ["Lucas <lucas@example.com>", 50, 720, 1, ["Dinner on Sunday?"]],
  ["Sunrise Senior Center <news@sunrisecenter.org>", 17, 270, 7, ["This month at Sunrise"]],
];

export function sampleRecords(now = Date.now()): HeaderRecord[] {
  const records: HeaderRecord[] = [];
  for (const [from, count, firstDaysAgo, lastDaysAgo, subjects] of SENDERS) {
    for (let i = 0; i < count; i++) {
      const daysAgo = Math.round(firstDaysAgo - ((firstDaysAgo - lastDaysAgo) * i) / Math.max(count - 1, 1));
      const subject = subjects[i % subjects.length];
      records.push({ from, to: PARENT, authResults: PASS, date: now - daysAgo * DAY, sent: false, subject });
    }
  }
  for (let i = 0; i < 12; i++) {
    records.push({ from: PARENT, to: "Aunt Sue <sue@example.com>", authResults: [], date: now - i * 30 * DAY, sent: true });
  }
  records.push(
    { from: "Chase <alerts@chase.com>", to: PARENT, authResults: FAIL, date: now - 2 * DAY, sent: false, subject: "Your statement is ready" },
    { from: "Chase Bank <security@chase-secure-login.co>", to: PARENT, authResults: FAIL, date: now - DAY, sent: false, subject: "Security alert: unusual sign-in" },
  );
  return records;
}
