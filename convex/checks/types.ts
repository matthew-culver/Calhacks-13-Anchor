// The parsed shape every check reads. Built by parseEml() from raw RFC 822 source
// (a Gmail "raw" message or a saved .eml file). It lives only in memory at check time:
// never store it, because it holds the body.

export type Link = {
  text: string; // what the reader sees, e.g. "www.chase.com" or "Review activity"
  href: string; // where it really goes
};

export type ParsedEmail = {
  fromName: string; // display name, "" if none
  fromAddress: string; // lowercased, e.g. "alerts@chase-secure-login.co"
  fromDomain: string; // lowercased part after the @
  multipleFrom: boolean; // more than one From address: mail apps disagree on which to show
  subject: string;
  // Every Authentication-Results header, top first. The top ones were added by the
  // receiving server (Gmail); anything below can be forged by the sender.
  authResults: string[];
  // Everything a reader could see: the plain-text part plus the visible text of the HTML part.
  text: string;
  links: Link[];
  // Text a reader would not see: HTML hidden by style, zero-size or same-color text, and
  // HTML comments. Normal newsletters use this for preview text; scams use it to talk to AI.
  hiddenText: string[];
  truncated: boolean; // too big to read in full; the checks saw only the first part
};
