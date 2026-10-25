// Organizations older adults commonly deal with, for the auto-built "My Accounts" page.
// `domains` are every registrable domain the org sends email from (or signs people in on).
// `loginUrl` is its sign-in page, typed here by hand and never taken from an email: each one was
// checked to load (or, for a few that block bots, confirmed by hand) on the org's own domain,
// in October 2026. Where there's no single sign-in page, it's the homepage. Its host must be
// inside `domains` (a test checks this). To add one: append an entry. Companies not listed here
// get a sign-in page found by Claude instead (convex/signInPages.ts).

import type { AccountCategory } from "../contract";

export type Org = {
  name: string;
  category: AccountCategory;
  domains: string[];
  loginUrl: string;
};

export const ORGS: Org[] = [
  // Banks and money
  { name: "Chase", category: "bank", domains: ["chase.com", "jpmorganchase.com", "jpmorgan.com"], loginUrl: "https://secure.chase.com/web/auth/dashboard" },
  { name: "Wells Fargo", category: "bank", domains: ["wellsfargo.com", "wf.com", "wellsfargoadvisors.com"], loginUrl: "https://connect.secure.wellsfargo.com/auth/login/present" },
  { name: "Bank of America", category: "bank", domains: ["bankofamerica.com", "bofa.com", "ml.com", "merrilledge.com"], loginUrl: "https://secure.bankofamerica.com/auth/signon/" },
  { name: "Citi", category: "bank", domains: ["citi.com", "citibank.com", "citicards.com"], loginUrl: "https://www.citi.com/login" },
  { name: "Capital One", category: "bank", domains: ["capitalone.com"], loginUrl: "https://verified.capitalone.com/auth/signin" },
  { name: "U.S. Bank", category: "bank", domains: ["usbank.com"], loginUrl: "https://onlinebanking.usbank.com/auth/login/" },
  { name: "American Express", category: "bank", domains: ["americanexpress.com", "aexp.com"], loginUrl: "https://www.americanexpress.com/en-us/account/login" },
  { name: "Discover", category: "bank", domains: ["discover.com"], loginUrl: "https://www.discover.com/login/" },
  { name: "Charles Schwab", category: "bank", domains: ["schwab.com"], loginUrl: "https://client.schwab.com/Areas/Access/Login" },
  { name: "Fidelity", category: "bank", domains: ["fidelity.com"], loginUrl: "https://digital.fidelity.com/prgw/digital/signin/retail" },
  { name: "Vanguard", category: "bank", domains: ["vanguard.com"], loginUrl: "https://logon.vanguard.com/logon" },
  { name: "PayPal", category: "bank", domains: ["paypal.com"], loginUrl: "https://www.paypal.com/signin" },
  { name: "Venmo", category: "bank", domains: ["venmo.com"], loginUrl: "https://venmo.com/account/sign-in" },
  { name: "PNC", category: "bank", domains: ["pnc.com"], loginUrl: "https://secure.pnc.com/" },
  { name: "Truist", category: "bank", domains: ["truist.com"], loginUrl: "https://dias.bank.truist.com/ui/login" },
  { name: "TD Bank", category: "bank", domains: ["td.com", "tdbank.com"], loginUrl: "https://onlinebanking.tdbank.com/" },
  { name: "Ally", category: "bank", domains: ["ally.com"], loginUrl: "https://secure.ally.com/" },
  { name: "Navy Federal Credit Union", category: "bank", domains: ["navyfederal.org"], loginUrl: "https://digitalomni.navyfederal.org/signin/" },
  { name: "USAA", category: "bank", domains: ["usaa.com"], loginUrl: "https://www.usaa.com/my/logon" },
  { name: "Citizens Bank", category: "bank", domains: ["citizensbank.com", "citizensbankonline.com"], loginUrl: "https://www.citizensbankonline.com/olb-root/login" },
  { name: "Fifth Third Bank", category: "bank", domains: ["53.com"], loginUrl: "https://www.53.com/content/fifth-third/en/login.html" },
  { name: "Huntington Bank", category: "bank", domains: ["huntington.com"], loginUrl: "https://onlinebanking.huntington.com/" }, // blocks bots; confirmed by hand
  { name: "KeyBank", category: "bank", domains: ["key.com"], loginUrl: "https://ibx.key.com/ibxolb/login/" },
  { name: "Regions Bank", category: "bank", domains: ["regions.com"], loginUrl: "https://login.regions.com/" },
  { name: "M&T Bank", category: "bank", domains: ["mtb.com"], loginUrl: "https://onlinebanking.mtb.com/" },
  { name: "Synchrony", category: "bank", domains: ["synchrony.com", "mysynchrony.com", "syf.com"], loginUrl: "https://www.synchrony.com/signin" },
  { name: "Edward Jones", category: "bank", domains: ["edwardjones.com"], loginUrl: "https://onlineaccess.edwardjones.com/app/oa-login" },
  { name: "Morgan Stanley", category: "bank", domains: ["morganstanley.com", "morganstanleyclientserv.com"], loginUrl: "https://login.morganstanleyclientserv.com/ux/" },
  { name: "TIAA", category: "bank", domains: ["tiaa.org"], loginUrl: "https://auth.tiaa.org/public/authentication/securelogin" },
  { name: "Golden 1 Credit Union", category: "bank", domains: ["golden1.com"], loginUrl: "https://login.golden1.com/" },

  // Health care
  { name: "Kaiser Permanente", category: "health", domains: ["kp.org", "kaiserpermanente.org"], loginUrl: "https://healthy.kaiserpermanente.org/sign-on" },
  { name: "Sutter Health", category: "health", domains: ["sutterhealth.org"], loginUrl: "https://myhealthonline.sutterhealth.org/mho/Authentication/Login" },
  { name: "Stanford Health Care", category: "health", domains: ["stanfordhealthcare.org"], loginUrl: "https://myhealth.stanfordhealthcare.org/" },
  { name: "UCSF Health", category: "health", domains: ["ucsfhealth.org", "ucsfmedicalcenter.org"], loginUrl: "https://ucsfmychart.ucsfmedicalcenter.org/" },
  { name: "Providence", category: "health", domains: ["providence.org"], loginUrl: "https://mychartor.providence.org/mychart/" },
  { name: "Mayo Clinic", category: "health", domains: ["mayoclinic.org"], loginUrl: "https://onlineservices.mayoclinic.org/patientportal" },
  { name: "Cleveland Clinic", category: "health", domains: ["clevelandclinic.org"], loginUrl: "https://mychart.clevelandclinic.org/" },
  { name: "Quest Diagnostics", category: "health", domains: ["questdiagnostics.com"], loginUrl: "https://myquest.questdiagnostics.com/" },
  { name: "Labcorp", category: "health", domains: ["labcorp.com"], loginUrl: "https://patient.labcorp.com/" },
  { name: "One Medical", category: "health", domains: ["onemedical.com"], loginUrl: "https://app.onemedical.com/login-web" },
  { name: "Dignity Health", category: "health", domains: ["dignityhealth.org", "commonspirit.org"], loginUrl: "https://www.dignityhealth.org/" }, // homepage: no single sign-in page

  // Pharmacies
  { name: "CVS Pharmacy", category: "pharmacy", domains: ["cvs.com", "cvshealth.com", "caremark.com"], loginUrl: "https://www.cvs.com/account-login" },
  { name: "Walgreens", category: "pharmacy", domains: ["walgreens.com"], loginUrl: "https://www.walgreens.com/login.jsp" },
  { name: "Express Scripts", category: "pharmacy", domains: ["express-scripts.com"], loginUrl: "https://www.express-scripts.com/login" },
  { name: "Optum Rx", category: "pharmacy", domains: ["optumrx.com", "optum.com", "healthsafe-id.com"], loginUrl: "https://new.optumrx.com/login" },

  // Insurance
  { name: "UnitedHealthcare", category: "insurance", domains: ["uhc.com", "unitedhealthcare.com", "myuhc.com"], loginUrl: "https://member.uhc.com/myuhc" },
  { name: "Aetna", category: "insurance", domains: ["aetna.com"], loginUrl: "https://health.aetna.com/login" },
  { name: "Humana", category: "insurance", domains: ["humana.com"], loginUrl: "https://account.humana.com/" },
  { name: "Blue Shield of California", category: "insurance", domains: ["blueshieldca.com"], loginUrl: "https://www.blueshieldca.com/login" },
  { name: "Anthem", category: "insurance", domains: ["anthem.com"], loginUrl: "https://www.anthem.com/login/" },
  { name: "Cigna", category: "insurance", domains: ["cigna.com"], loginUrl: "https://my.cigna.com/" },
  { name: "Delta Dental", category: "insurance", domains: ["deltadental.com", "deltadentalins.com"], loginUrl: "https://identity.deltadental.com/accounts/login/" },
  { name: "State Farm", category: "insurance", domains: ["statefarm.com"], loginUrl: "https://auth.proofing.statefarm.com/login-ui/login" },
  { name: "Allstate", category: "insurance", domains: ["allstate.com"], loginUrl: "https://myaccountrwd.allstate.com/anon/account/login" },
  { name: "GEICO", category: "insurance", domains: ["geico.com"], loginUrl: "https://ecams.geico.com/" },
  { name: "Progressive", category: "insurance", domains: ["progressive.com"], loginUrl: "https://account.apps.progressive.com/access/login" },
  { name: "Liberty Mutual", category: "insurance", domains: ["libertymutual.com"], loginUrl: "https://www.libertymutual.com/log-in" },
  { name: "Farmers Insurance", category: "insurance", domains: ["farmers.com"], loginUrl: "https://www.farmers.com/css/login" },
  { name: "Nationwide", category: "insurance", domains: ["nationwide.com"], loginUrl: "https://www.nationwide.com/my-account-login" },

  // Government
  { name: "Medicare", category: "government", domains: ["medicare.gov", "cms.gov", "hhs.gov"], loginUrl: "https://www.medicare.gov/account/login" },
  { name: "Social Security", category: "government", domains: ["ssa.gov"], loginUrl: "https://secure.ssa.gov/RIL/SiView.action" },
  { name: "IRS", category: "government", domains: ["irs.gov", "treasury.gov"], loginUrl: "https://www.irs.gov/your-account" },
  { name: "USPS", category: "government", domains: ["usps.com", "usps.gov"], loginUrl: "https://reg.usps.com/entreg/LoginAction_input" },
  { name: "Veterans Affairs", category: "government", domains: ["va.gov"], loginUrl: "https://www.va.gov/sign-in/" },
  { name: "TreasuryDirect", category: "government", domains: ["treasurydirect.gov"], loginUrl: "https://www.treasurydirect.gov/log-in/" },

  // Utilities, phone and internet
  { name: "PG&E", category: "utility", domains: ["pge.com", "pgecorp.com"], loginUrl: "https://myaccount.pge.com/myaccount/s/login" },
  { name: "Southern California Edison", category: "utility", domains: ["sce.com"], loginUrl: "https://www.sce.com/my-account" },
  { name: "SDG&E", category: "utility", domains: ["sdge.com", "myenergycenter.com"], loginUrl: "https://myenergycenter.com/portal/PreLogin/Validate" },
  { name: "SoCalGas", category: "utility", domains: ["socalgas.com"], loginUrl: "https://myaccount.socalgas.com/ui/login" },
  { name: "Duke Energy", category: "utility", domains: ["duke-energy.com"], loginUrl: "https://www.duke-energy.com/my-account/dashboard" },
  { name: "Con Edison", category: "utility", domains: ["coned.com"], loginUrl: "https://www.coned.com/en/login" },
  // att-mail.com: "All AT&T emails are sent from att-mail.com" (att.com/support/article/my-account/KM1010136)
  { name: "AT&T", category: "utility", domains: ["att.com", "att-mail.com"], loginUrl: "https://www.att.com/acctmgmt/login" },
  { name: "Verizon", category: "utility", domains: ["verizon.com", "verizonwireless.com"], loginUrl: "https://secure.verizon.com/signin" },
  { name: "Xfinity", category: "utility", domains: ["xfinity.com", "comcast.com"], loginUrl: "https://login.xfinity.com/login" },
  { name: "T-Mobile", category: "utility", domains: ["t-mobile.com"], loginUrl: "https://account.t-mobile.com/" },
  { name: "Spectrum", category: "utility", domains: ["spectrum.com", "spectrum.net", "charter.com"], loginUrl: "https://www.spectrum.net/" },
  { name: "Cox", category: "utility", domains: ["cox.com"], loginUrl: "https://www.cox.com/content/dam/cox/okta/signin.html" },

  // Shopping
  { name: "Amazon", category: "shopping", domains: ["amazon.com", "amazonpay.com"], loginUrl: "https://www.amazon.com/gp/sign-in.html" },
  { name: "Costco", category: "shopping", domains: ["costco.com"], loginUrl: "https://www.costco.com/LogonForm" },
  { name: "Walmart", category: "shopping", domains: ["walmart.com"], loginUrl: "https://www.walmart.com/account/login" },
  { name: "Target", category: "shopping", domains: ["target.com"], loginUrl: "https://www.target.com/login" },
  { name: "eBay", category: "shopping", domains: ["ebay.com"], loginUrl: "https://signin.ebay.com/" },
  { name: "Etsy", category: "shopping", domains: ["etsy.com"], loginUrl: "https://www.etsy.com/signin" },
  { name: "The Home Depot", category: "shopping", domains: ["homedepot.com"], loginUrl: "https://www.homedepot.com/auth/view/signin" },
  { name: "Lowe's", category: "shopping", domains: ["lowes.com"], loginUrl: "https://www.lowes.com/u/login" },
  { name: "Best Buy", category: "shopping", domains: ["bestbuy.com"], loginUrl: "https://www.bestbuy.com/identity/global/signin" },
  { name: "Macy's", category: "shopping", domains: ["macys.com"], loginUrl: "https://www.macys.com/account/signin" },
  { name: "Kohl's", category: "shopping", domains: ["kohls.com"], loginUrl: "https://www.kohls.com/myaccount/signin.jsp" },
  { name: "Nordstrom", category: "shopping", domains: ["nordstrom.com"], loginUrl: "https://www.nordstrom.com/signin" },
  { name: "Chewy", category: "shopping", domains: ["chewy.com"], loginUrl: "https://www.chewy.com/app/login" }, // blocks bots; confirmed by hand
  { name: "Wayfair", category: "shopping", domains: ["wayfair.com"], loginUrl: "https://www.wayfair.com/v/account/authentication/login" },
  { name: "QVC", category: "shopping", domains: ["qvc.com"], loginUrl: "https://www.qvc.com/myaccount/login.html" },
  { name: "Instacart", category: "shopping", domains: ["instacart.com"], loginUrl: "https://www.instacart.com/login" },
  { name: "Safeway", category: "shopping", domains: ["safeway.com"], loginUrl: "https://www.safeway.com/account/sign-in.html" },
  { name: "Kroger", category: "shopping", domains: ["kroger.com"], loginUrl: "https://www.kroger.com/signin" },

  // Subscriptions and everything else
  { name: "Netflix", category: "other", domains: ["netflix.com"], loginUrl: "https://www.netflix.com/login" },
  { name: "Disney+", category: "other", domains: ["disneyplus.com"], loginUrl: "https://www.disneyplus.com/identity/login" },
  { name: "Hulu", category: "other", domains: ["hulu.com"], loginUrl: "https://auth.hulu.com/web/login" },
  { name: "Spotify", category: "other", domains: ["spotify.com"], loginUrl: "https://accounts.spotify.com/login" },
  { name: "Roku", category: "other", domains: ["roku.com"], loginUrl: "https://my.roku.com/signin" },
  { name: "The New York Times", category: "other", domains: ["nytimes.com"], loginUrl: "https://myaccount.nytimes.com/auth/enter-email" }, // blocks bots; confirmed by hand
  { name: "Apple", category: "other", domains: ["apple.com"], loginUrl: "https://account.apple.com/sign-in" },
  { name: "Google", category: "other", domains: ["google.com"], loginUrl: "https://accounts.google.com/" },
  { name: "Microsoft", category: "other", domains: ["microsoft.com"], loginUrl: "https://account.microsoft.com/" },
  { name: "Facebook", category: "other", domains: ["facebook.com", "facebookmail.com"], loginUrl: "https://www.facebook.com/login" },
  { name: "AARP", category: "other", domains: ["aarp.org"], loginUrl: "https://secure.aarp.org/applications/user/login" },
];

/** The directory org this registrable domain belongs to, if any. */
export function orgForDomain(registrable: string): Org | undefined {
  const d = registrable.toLowerCase();
  return ORGS.find((o) => o.domains.includes(d));
}
