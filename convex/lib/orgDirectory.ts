// Organizations older adults commonly deal with, for the auto-built "My Accounts" page.
// `domains` are every registrable domain the org sends email from. `loginUrl` is its
// official website (where "Sign in" lives), typed here by hand: never taken from an email.
// Its host must be inside `domains` (a test checks this). To add one: append an entry.

import type { AccountCategory } from "../contract";

export type Org = {
  name: string;
  category: AccountCategory;
  domains: string[];
  loginUrl: string;
};

export const ORGS: Org[] = [
  // Banks and money
  { name: "Chase", category: "bank", domains: ["chase.com", "jpmorganchase.com", "jpmorgan.com"], loginUrl: "https://www.chase.com/" },
  { name: "Wells Fargo", category: "bank", domains: ["wellsfargo.com", "wf.com", "wellsfargoadvisors.com"], loginUrl: "https://www.wellsfargo.com/" },
  { name: "Bank of America", category: "bank", domains: ["bankofamerica.com", "bofa.com", "ml.com", "merrilledge.com"], loginUrl: "https://www.bankofamerica.com/" },
  { name: "Citi", category: "bank", domains: ["citi.com", "citibank.com", "citicards.com"], loginUrl: "https://www.citi.com/" },
  { name: "Capital One", category: "bank", domains: ["capitalone.com"], loginUrl: "https://www.capitalone.com/" },
  { name: "U.S. Bank", category: "bank", domains: ["usbank.com"], loginUrl: "https://www.usbank.com/" },
  { name: "American Express", category: "bank", domains: ["americanexpress.com", "aexp.com"], loginUrl: "https://www.americanexpress.com/" },
  { name: "Discover", category: "bank", domains: ["discover.com"], loginUrl: "https://www.discover.com/" },
  { name: "Charles Schwab", category: "bank", domains: ["schwab.com"], loginUrl: "https://www.schwab.com/" },
  { name: "Fidelity", category: "bank", domains: ["fidelity.com"], loginUrl: "https://www.fidelity.com/" },
  { name: "Vanguard", category: "bank", domains: ["vanguard.com"], loginUrl: "https://investor.vanguard.com/" },
  { name: "PayPal", category: "bank", domains: ["paypal.com"], loginUrl: "https://www.paypal.com/" },

  // Health care
  { name: "Kaiser Permanente", category: "health", domains: ["kp.org", "kaiserpermanente.org"], loginUrl: "https://healthy.kaiserpermanente.org/" },
  { name: "Sutter Health", category: "health", domains: ["sutterhealth.org"], loginUrl: "https://www.sutterhealth.org/" },

  // Pharmacies
  { name: "CVS Pharmacy", category: "pharmacy", domains: ["cvs.com", "cvshealth.com", "caremark.com"], loginUrl: "https://www.cvs.com/" },
  { name: "Walgreens", category: "pharmacy", domains: ["walgreens.com"], loginUrl: "https://www.walgreens.com/" },
  { name: "Express Scripts", category: "pharmacy", domains: ["express-scripts.com"], loginUrl: "https://www.express-scripts.com/" },

  // Insurance
  { name: "UnitedHealthcare", category: "insurance", domains: ["uhc.com", "unitedhealthcare.com"], loginUrl: "https://www.uhc.com/" },
  { name: "Aetna", category: "insurance", domains: ["aetna.com"], loginUrl: "https://www.aetna.com/" },
  { name: "Humana", category: "insurance", domains: ["humana.com"], loginUrl: "https://www.humana.com/" },
  { name: "Blue Shield of California", category: "insurance", domains: ["blueshieldca.com"], loginUrl: "https://www.blueshieldca.com/" },
  { name: "Anthem", category: "insurance", domains: ["anthem.com"], loginUrl: "https://www.anthem.com/" },
  { name: "State Farm", category: "insurance", domains: ["statefarm.com"], loginUrl: "https://www.statefarm.com/" },
  { name: "Allstate", category: "insurance", domains: ["allstate.com"], loginUrl: "https://www.allstate.com/" },
  { name: "GEICO", category: "insurance", domains: ["geico.com"], loginUrl: "https://www.geico.com/" },

  // Government
  { name: "Medicare", category: "government", domains: ["medicare.gov", "cms.gov", "hhs.gov"], loginUrl: "https://www.medicare.gov/" },
  { name: "Social Security", category: "government", domains: ["ssa.gov"], loginUrl: "https://www.ssa.gov/myaccount/" },
  { name: "IRS", category: "government", domains: ["irs.gov", "treasury.gov"], loginUrl: "https://www.irs.gov/" },
  { name: "USPS", category: "government", domains: ["usps.com", "usps.gov"], loginUrl: "https://www.usps.com/" },

  // Utilities and phone
  { name: "PG&E", category: "utility", domains: ["pge.com", "pgecorp.com"], loginUrl: "https://www.pge.com/" },
  { name: "AT&T", category: "utility", domains: ["att.com"], loginUrl: "https://www.att.com/" },
  { name: "Verizon", category: "utility", domains: ["verizon.com", "verizonwireless.com"], loginUrl: "https://www.verizon.com/" },
  { name: "Xfinity", category: "utility", domains: ["xfinity.com", "comcast.com"], loginUrl: "https://www.xfinity.com/" },
  { name: "T-Mobile", category: "utility", domains: ["t-mobile.com"], loginUrl: "https://www.t-mobile.com/" },
  { name: "Spectrum", category: "utility", domains: ["spectrum.com", "spectrum.net"], loginUrl: "https://www.spectrum.net/" },

  // Shopping and subscriptions
  { name: "Amazon", category: "shopping", domains: ["amazon.com", "amazonpay.com"], loginUrl: "https://www.amazon.com/" },
  { name: "Costco", category: "shopping", domains: ["costco.com"], loginUrl: "https://www.costco.com/" },
  { name: "Walmart", category: "shopping", domains: ["walmart.com"], loginUrl: "https://www.walmart.com/" },
  { name: "Target", category: "shopping", domains: ["target.com"], loginUrl: "https://www.target.com/" },
  { name: "eBay", category: "shopping", domains: ["ebay.com"], loginUrl: "https://www.ebay.com/" },
  { name: "Apple", category: "other", domains: ["apple.com"], loginUrl: "https://www.apple.com/" },
  { name: "Netflix", category: "other", domains: ["netflix.com"], loginUrl: "https://www.netflix.com/" },
  { name: "AARP", category: "other", domains: ["aarp.org"], loginUrl: "https://www.aarp.org/" },
];

/** The directory org this registrable domain belongs to, if any. */
export function orgForDomain(registrable: string): Org | undefined {
  const d = registrable.toLowerCase();
  return ORGS.find((o) => o.domains.includes(d));
}
