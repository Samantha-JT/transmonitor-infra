export interface ServerFeed { name: string; url: string; lang?: string; }
const gn = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const gnGB = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;
export const VARIANT_FEEDS: Record<string, Record<string, ServerFeed[]>> = {
  trans: {
    legal: [
      { name: 'Erin in the Morning', url: 'https://www.erininthemorning.com/feed' },
      { name: 'Trans Legislation Tracker', url: 'https://translegislation.com/rss.xml' },
      { name: 'ACLU LGBT News', url: 'https://www.aclu.org/news/lgbtq-rights/feed' },
      { name: 'Lambda Legal', url: gn('site:lambdalegal.org when:7d') },
      { name: 'UK Trans Law', url: gnGB('("GRC" OR "Gender Recognition Act" OR "Cass Review" OR "Equality Act") UK when:3d') },
      { name: 'US Trans Legislation', url: gn('("gender-affirming care ban" OR "trans bill" OR "bathroom bill" OR "drag ban") when:3d') },
      { name: 'EU Gender Recognition', url: gn('("gender self-determination" OR "Ley Trans" OR "Selbstbestimmungsgesetz") when:7d') },
    ],
    healthcare: [
      { name: 'Gender Analysis', url: 'https://genderanalysis.net/feed/' },
      { name: 'WPATH News', url: gn('site:wpath.org when:14d') },
      { name: 'Cass Review Coverage', url: gn('("Cass Review" OR "Tavistock clinic") when:7d') },
      { name: 'Trans Healthcare Access', url: gn('("transgender" OR "trans rights") ("gender-affirming care" OR "puberty blockers" OR "hormone therapy") when:3d') },
      { name: 'Puberty Blocker Rulings', url: gn('"puberty blockers" (court OR ruling OR ban) when:7d') },
    ],
    community: [
      { name: 'PinkNews', url: 'https://www.thepinknews.com/feed/' },
      { name: 'LGBTQ Nation', url: 'https://www.lgbtqnation.com/feed/' },
      { name: 'Them', url: 'https://www.them.us/feed/rss' },
      { name: 'Xtra Magazine', url: 'https://xtramagazine.com/feed' },
      { name: 'Autostraddle', url: 'https://www.autostraddle.com/feed/' },
      { name: 'The 19th', url: 'https://19thnews.org/category/lgbtq/feed/' },
    ],
    international: [
      { name: 'Reuters Trans Coverage', url: gn('site:reuters.com ("transgender" OR "trans rights") when:7d') },
      { name: 'ILGA World', url: gn('site:ilga.org when:30d') },
      { name: 'TGEU (Europe)', url: gn('site:tgeu.org when:30d') },
      { name: 'LatAm Trans Rights', url: gn('("Ley de Identidad de Genero" OR "transgender rights" OR "travesti") when:7d') },
      { name: 'Asia-Pacific Trans News', url: gn('("transgender" OR "hijra") (Thailand OR Japan OR Korea OR India) when:7d') },
    ],
    safety: [
      { name: 'Trans Murder Monitoring', url: gn('site:transrespect.org when:30d') },
      { name: 'TDoR / TDoV Coverage', url: gn('("Trans Day of Remembrance" OR "TDoR" OR "Trans Day of Visibility") when:30d') },
      { name: 'Trans Violence News', url: gn('("transgender" OR "trans woman" OR "trans man") ("hate crime" OR "attacked" OR "murdered") when:3d') },
      { name: 'UK Trans Safety', url: gnGB('("transgender" OR "trans") ("hate crime" OR "attack" OR "violence") UK when:7d') },
      { name: 'HRC Violence Tracker', url: gn('site:hrc.org ("violence" OR "fatal" OR "transgender") when:30d') },
    ],
    "uk-press": [
      { name: 'BBC News', url: gnGB('(transgender OR "trans rights" OR "Cass Review") site:bbc.co.uk when:3d') },
      { name: 'The Guardian', url: gnGB('(transgender OR "trans rights") site:theguardian.com when:3d') },
      { name: 'The Independent', url: gnGB('(transgender OR "trans rights") site:independent.co.uk when:3d') },
      { name: 'Sky News', url: gnGB('(transgender OR "trans rights") site:news.sky.com when:3d') },
      { name: 'Channel 4 News', url: gnGB('(transgender OR "trans rights") site:channel4.com when:7d') },
    ],
    wins: [
      { name: 'Trans Wins', url: gnGB('(transgender OR "trans rights") (wins OR victory OR "first trans" OR milestone OR landmark) when:7d') },
      { name: 'Trans Legal Wins', url: gn('(transgender OR "trans rights") (court OR judge) (blocks OR overturns) when:7d') },
    ],
    mainstream: [
      { name: 'BBC Trans Coverage', url: gnGB('site:bbc.co.uk ("transgender" OR "trans rights" OR "Cass Review") when:3d') },
      { name: 'Guardian Trans', url: gnGB('site:theguardian.com ("transgender" OR "trans rights") when:3d') },
      { name: 'Reuters LGBT', url: gn('site:reuters.com ("transgender" OR "gender-affirming care") when:3d') },
      { name: 'Washington Post Trans', url: gn('site:washingtonpost.com ("transgender" OR "gender-affirming care ban") when:7d') },
      { name: 'NYT Trans Coverage', url: gn('site:nytimes.com ("transgender" OR "gender-affirming care ban") when:7d') },
    ],
  },
};
export const INTEL_SOURCES: ServerFeed[] = [];